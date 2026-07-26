#!/usr/bin/env python3
"""Calibration harness for the minichord SysEx transport.

Measures, against a physically attached device, the numbers that the simulator
and the write-coalescing policy need:

  T1  dump round-trip latency          -- how long a (0, 0) command takes to answer
  T2  sustained ingest rate            -- the firmware's main-loop period, from burst drain time
  T3  loss threshold vs. pacing        -- at which inter-message interval writes start disappearing
  T4  preset-load burst (254 messages) -- the realistic worst case, checked for loss

The firmware calls usbMIDI.read() once per loop() iteration (firmware/src/main.cpp),
so ingest is capped at one SysEx per iteration. T2 measures that iteration period
directly instead of inferring it from loss.

Talks to the device over the ALSA rawmidi character device, not through a browser:
the throughput research (issue #3) established that Chromium imposes no meaningful
limit at these volumes, so the browser would only add noise between us and the
firmware, which is what we are actually measuring.

Nothing reaches flash: the only command ever sent is (0, 0), the request for a
dump. Commands 1 (wipe), 2 (save to bank) and 3 (reset bank) are never sent, so
no stored bank can be altered and the device is left as it was found.

Sound, however, is *not* untouched throughout. T1-T3 write only to the SysEx
addresses that appear in no parameter of parameters.json, so apply_audio_parameter()
ignores them; T4 is different by design -- it reproduces a real 254-message preset
load, which means writing every address from 2 to 255. Those writes carry the
values read back in the dump taken at the start of T4, so they are normally an
identity rewrite. If the operator moves a potentiometer or presses a preset button
while T4 runs, that snapshot goes stale and the next burst pushes the device back
to it. Leave the device alone for the duration of the run.

Note also what T4's loss figure can and cannot say: only the ~39 probe addresses
carry a sentinel, so a lost write to one of the 215 real parameter addresses --
which are rewritten with the value already held -- leaves no trace. See
`observedLossBound` in src/dev/simulator/fakeMidiAccess.ts for what the result
actually bounds.

Usage:
    python3 measure-device.py [--device /dev/snd/midiC2D0] [--json out.json]
"""

from __future__ import annotations

import argparse
import errno
import json
import os
import statistics
import sys
import threading
import time
from pathlib import Path

PARAMETER_SIZE = 256
DUMP_FRAME_LEN = PARAMETER_SIZE * 2 + 2  # F0 + 512 payload bytes + F7

REPO_ROOT = Path(__file__).resolve().parents[3]
PARAMETERS_JSON = REPO_ROOT / "firmware" / "generator" / "parameters.json"


def free_addresses() -> list[int]:
    """Addresses in 2..235 that no parameter claims, safe to use as probes."""
    groups = json.loads(PARAMETERS_JSON.read_text())
    used = {p["sysex_adress"] for group in groups.values() for p in group}
    return [a for a in range(2, 236) if a not in used]


class Device:
    """Raw SysEx access to the minichord over an ALSA rawmidi node."""

    def __init__(self, path: str) -> None:
        self.path = path
        self.reconnects = 0
        self.fd = os.open(path, os.O_RDWR)
        self.dumps: list[tuple[float, list[int]]] = []
        # A condition rather than a polled flag: busy-waiting on the main thread
        # starves the reader badly enough to fake multi-second dump losses.
        self._arrived = threading.Condition()
        self._stop = threading.Event()
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def _read_loop(self) -> None:
        buf = bytearray()
        while not self._stop.is_set():
            fd = self.fd
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                return  # closed, or superseded by a reader on a reopened fd
            if fd != self.fd:
                return
            if not chunk:
                continue
            now = time.perf_counter()
            buf.extend(chunk)
            # Carve out complete F0..F7 frames; drop anything before an F0.
            while True:
                start = buf.find(0xF0)
                if start < 0:
                    buf.clear()
                    break
                end = buf.find(0xF7, start)
                if end < 0:
                    del buf[:start]
                    break
                frame = bytes(buf[start : end + 1])
                del buf[: end + 1]
                if len(frame) == DUMP_FRAME_LEN:
                    payload = frame[1:-1]
                    values = [
                        payload[2 * i] + 128 * payload[2 * i + 1]
                        for i in range(PARAMETER_SIZE)
                    ]
                    with self._arrived:
                        self.dumps.append((now, values))
                        self._arrived.notify_all()

    def _reopen(self, timeout: float = 30.0) -> None:
        self.reconnects += 1
        print(f"    !! device disconnected (re-enumeration #{self.reconnects}), waiting")
        try:
            os.close(self.fd)
        except OSError:
            pass
        deadline = time.perf_counter() + timeout
        while time.perf_counter() < deadline:
            try:
                self.fd = os.open(self.path, os.O_RDWR)
            except OSError:
                time.sleep(0.5)
                continue
            print("    !! device back")
            self._reader = threading.Thread(target=self._read_loop, daemon=True)
            self._reader.start()
            return
        raise RuntimeError(f"device did not come back within {timeout}s")

    def close(self) -> None:
        self._stop.set()
        os.close(self.fd)

    # -- writing ---------------------------------------------------------

    def _send(self, payload: bytes) -> None:
        # os.write on an ALSA rawmidi node writes at most one output-buffer
        # worth (4 KB by default) and returns short. Ignoring that truncates
        # the last frame mid-message, and the device then swallows whatever
        # is sent next as part of the malformed SysEx.
        view = memoryview(payload)
        while view:
            try:
                view = view[os.write(self.fd, view) :]
            except OSError as error:
                if error.errno != errno.ENODEV:
                    raise
                # The device dropped off the USB bus mid-run. That is itself a
                # finding, so count it and carry on rather than losing the
                # campaign; the write that hit it is abandoned.
                self._reopen()
                return

    @staticmethod
    def frame(address: int, value: int) -> bytes:
        return bytes(
            [0xF0, address % 128, address // 128, value % 128, value // 128, 0xF7]
        )

    def write(self, address: int, value: int) -> None:
        self._send(self.frame(address, value))

    def command(self, command: int, argument: int) -> None:
        self._send(bytes([0xF0, 0, 0, command, argument, 0xF7]))

    def burst(self, writes: list[tuple[int, int]], interval_s: float) -> float:
        """Send writes paced at interval_s. Returns the wall time it took."""
        started = time.perf_counter()
        if interval_s <= 0:
            self._send(b"".join(self.frame(a, v) for a, v in writes))
        else:
            deadline = started
            for address, value in writes:
                self.write(address, value)
                deadline += interval_s
                remaining = deadline - time.perf_counter()
                if remaining > 0:
                    time.sleep(remaining)
        return time.perf_counter() - started

    # -- reading ---------------------------------------------------------

    def dump(self, timeout: float = 3.0) -> tuple[list[int], float]:
        """Request a dump; return its values and the round-trip time."""
        with self._arrived:
            seen = len(self.dumps)
            sent = time.perf_counter()
            self.command(0, 0)
            if not self._arrived.wait_for(lambda: len(self.dumps) > seen, timeout):
                raise TimeoutError(f"no dump within {timeout}s")
            arrived, values = self.dumps[seen]
        return values, arrived - sent

    def drain_after(self, writes: list[tuple[int, int]], timeout: float = 15.0) -> float:
        """Send writes with no pacing, then a dump command; time until the dump lands.

        With one usbMIDI.read() per loop() the device services the queue one
        message per iteration, so this time grows linearly with len(writes) and
        its slope is the main-loop period.
        """
        with self._arrived:
            seen = len(self.dumps)
            started = time.perf_counter()
            self._send(b"".join(self.frame(a, v) for a, v in writes))
            self.command(0, 0)
            if not self._arrived.wait_for(lambda: len(self.dumps) > seen, timeout):
                raise TimeoutError(
                    f"no dump within {timeout}s after {len(writes)} writes"
                )
            arrived, _ = self.dumps[seen]
        return arrived - started


def dump_with_retry(dev: Device, attempts: int = 4) -> list[int]:
    """A dump used as an observation rather than as a measurement.

    The device occasionally leaves a (0, 0) unanswered, so every place that
    only wants to read state back retries instead of aborting the run. T1 is
    the one test that measures this rather than papering over it.
    """
    for attempt in range(attempts):
        try:
            values, _ = dev.dump(timeout=2.0)
            return values
        except TimeoutError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.2)
    raise AssertionError("unreachable")


def summarise(samples: list[float]) -> dict[str, float]:
    ordered = sorted(samples)
    return {
        "n": len(ordered),
        "min_ms": round(ordered[0] * 1000, 3),
        "median_ms": round(statistics.median(ordered) * 1000, 3),
        "p95_ms": round(ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))] * 1000, 3),
        "max_ms": round(ordered[-1] * 1000, 3),
    }


# -- tests ---------------------------------------------------------------


def t1_dump_latency(dev: Device, rounds: int = 500) -> dict:
    """Round-trip of the (0, 0) command. Timeouts are data, not failures.

    The state model (#8) has to pick a retry timeout, so the tail of this
    distribution is the interesting part, not the median.
    """
    print(f"T1  dump round-trip latency ({rounds} rounds)")
    samples: list[float] = []
    timeouts = 0
    for _ in range(rounds):
        try:
            _, rtt = dev.dump(timeout=2.0)
            samples.append(rtt)
        except TimeoutError:
            timeouts += 1
        time.sleep(0.02)
    result = summarise(samples) | {
        "timeouts": timeouts,
        "timeout_threshold_ms": 2000,
        "over_10ms": sum(1 for s in samples if s > 0.010),
        "over_100ms": sum(1 for s in samples if s > 0.100),
    }
    print(f"    {result}")
    return result


def t2_loop_period(dev: Device, probe: int, counts: list[int]) -> dict:
    print(f"T2  burst drain time vs. burst size (probe address {probe})")
    points = []
    for n in counts:
        trials = []
        while len(trials) < 5:
            try:
                trials.append(dev.drain_after([(probe, i % 128) for i in range(n)]))
            except TimeoutError:
                time.sleep(0.3)  # an unanswered command costs a sample, not the run
        best = min(trials)  # the least-perturbed run
        points.append((n, best))
        print(f"    n={n:4d}  drain={best * 1000:8.2f} ms  (median {statistics.median(trials) * 1000:.2f})")
        time.sleep(0.2)

    # Least-squares slope: seconds of drain per extra queued message.
    xs = [float(n) for n, _ in points]
    ys = [t for _, t in points]
    mean_x, mean_y = statistics.mean(xs), statistics.mean(ys)
    denominator = sum((x - mean_x) ** 2 for x in xs)
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denominator
    intercept = mean_y - slope * mean_x
    result = {
        "points": [{"messages": n, "drain_ms": round(t * 1000, 3)} for n, t in points],
        "loop_period_ms": round(slope * 1000, 4),
        "messages_per_second": round(1 / slope, 1) if slope > 0 else None,
        "dump_only_intercept_ms": round(intercept * 1000, 3),
    }
    print(
        f"    -> loop period {result['loop_period_ms']} ms "
        f"= {result['messages_per_second']} messages/s"
    )
    return result


def t3_loss_vs_pacing(dev: Device, probes: list[int], intervals_ms: list[float], rounds: int = 5) -> dict:
    print(f"T3  loss vs. pacing over {len(probes)} probe addresses, {rounds} rounds each")
    results = []
    for interval_ms in intervals_ms:
        lost_total = 0
        sent_total = 0
        for round_index in range(rounds):
            sentinel = {a: (a * 3 + round_index * 7) % 1000 + 1 for a in probes}
            dev.burst([(a, sentinel[a]) for a in probes], interval_ms / 1000)
            time.sleep(0.3)
            values = dump_with_retry(dev)
            lost = sum(1 for a in probes if values[a] != sentinel[a])
            lost_total += lost
            sent_total += len(probes)
        loss_rate = lost_total / sent_total
        results.append(
            {"interval_ms": interval_ms, "sent": sent_total, "lost": lost_total,
             "loss_rate": round(loss_rate, 4)}
        )
        print(f"    interval={interval_ms:6.2f} ms  lost {lost_total}/{sent_total}")
    lossless = [r["interval_ms"] for r in results if r["lost"] == 0]
    return {
        "rounds": results,
        "smallest_lossless_interval_ms": min(lossless) if lossless else None,
    }


def t4_preset_load(dev: Device, probes: list[int], intervals_ms: list[float], rounds: int = 3) -> dict:
    """The realistic worst case: 254 writes covering addresses 2..255.

    Real parameter addresses are rewritten with the value they already hold, so
    the sound never changes; the probe addresses carry sentinels, giving
    detectable slots inside an otherwise faithful preset-load burst.
    """
    print(f"T4  254-message preset-load burst, {rounds} rounds each")
    baseline = dump_with_retry(dev)
    results = []
    for interval_ms in intervals_ms:
        lost_total = 0
        for round_index in range(rounds):
            sentinel = {a: (a * 5 + round_index * 11) % 1000 + 1 for a in probes}
            writes = [
                (a, sentinel.get(a, baseline[a])) for a in range(2, PARAMETER_SIZE)
            ]
            dev.burst(writes, interval_ms / 1000)
            time.sleep(0.5)
            values = dump_with_retry(dev)
            lost_total += sum(1 for a in probes if values[a] != sentinel[a])
        results.append(
            {"interval_ms": interval_ms, "messages": 254, "rounds": rounds,
             "probe_slots": len(probes) * rounds, "lost": lost_total}
        )
        print(f"    interval={interval_ms:6.2f} ms  lost {lost_total}/{len(probes) * rounds} probe slots")
    return {"rounds": results}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", default="/dev/snd/midiC2D0",
                        help="ALSA rawmidi node of minichord cable 1")
    parser.add_argument("--json", help="write the full results here")
    args = parser.parse_args()

    probes = free_addresses()
    print(f"probe addresses ({len(probes)}): {probes}\n")

    dev = Device(args.device)
    try:
        before, rtt = dev.dump(timeout=5.0)
        print(f"connected: bank {before[1]}, firmware version {before[7]}, "
              f"first dump in {rtt * 1000:.1f} ms\n")

        results = {
            "device": args.device,
            "firmware_version": before[7],
            "bank": before[1],
            "probe_addresses": probes,
            "t1_dump_latency": t1_dump_latency(dev),
            "t2_loop_period": t2_loop_period(dev, probes[0], [0, 25, 50, 100, 200, 400, 800]),
            "t3_loss_vs_pacing": t3_loss_vs_pacing(dev, probes, [0, 0.2, 0.5, 1, 2, 4, 8]),
            "t4_preset_load": t4_preset_load(dev, probes, [0, 1, 2, 4, 8]),
        }

        # Leave the probe addresses as we found them.
        dev.burst([(a, before[a]) for a in probes], 0.01)
        time.sleep(0.3)
        after = dump_with_retry(dev)
        drift = [a for a in range(2, PARAMETER_SIZE) if after[a] != before[a]]
        results["usb_reenumerations"] = dev.reconnects
        results["restored"] = not drift
        results["drifted_addresses"] = drift
        print(f"\nrestore: {'clean' if not drift else f'drift at {drift}'}")

        if args.json:
            Path(args.json).write_text(json.dumps(results, indent=2))
            print(f"written to {args.json}")
        return 0
    finally:
        dev.close()


if __name__ == "__main__":
    sys.exit(main())
