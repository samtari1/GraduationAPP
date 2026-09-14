"""Threaded serial scanner service controlled by the local Stage Control UI."""
from __future__ import annotations

from threading import Event, Lock, Thread
from typing import Callable

from .scanner_bridge import ScanFrames


class SerialScannerService:
    def __init__(self):
        self._lock = Lock()
        self._stop = Event()
        self._thread: Thread | None = None
        self._serial = None
        self._status = {
            "connected": False, "port": None, "baud": None, "ceremony_id": None,
            "mode": None,
            "scan_count": 0, "revision": 0, "last_entry_id": None,
            "last_student": None, "last_error": None,
        }

    def ports(self):
        try:
            from serial.tools import list_ports
        except ImportError as error:
            raise RuntimeError("Install requirements-integrations.txt to enable serial scanning") from error
        return sorted([
            {"device": port.device, "description": port.description or "Serial device",
             "manufacturer": port.manufacturer}
            for port in list_ports.comports()
        ], key=lambda item: ("usb" not in item["device"].lower(), item["device"]))

    def status(self):
        with self._lock:
            return dict(self._status)

    def connect(self, port: str, baud: int, ceremony_id: int, mode: str, on_scan: Callable[[str], dict]):
        self.disconnect()
        try:
            import serial
        except ImportError as error:
            raise RuntimeError("Install requirements-integrations.txt to enable serial scanning") from error
        scanner = serial.Serial(port, baud, timeout=0.4)
        self._stop.clear()
        with self._lock:
            self._serial = scanner
            self._status.update({
                "connected": True, "port": port, "baud": baud, "ceremony_id": ceremony_id,
                "mode": mode,
                "scan_count": 0, "last_entry_id": None, "last_student": None, "last_error": None,
            })
        self._thread = Thread(target=self._run, args=(scanner, on_scan), daemon=True, name="gradvoice-serial-scanner")
        self._thread.start()
        return self.status()

    def _run(self, scanner, on_scan):
        frames = ScanFrames()
        try:
            while not self._stop.is_set():
                data = scanner.read(min(scanner.in_waiting or 1, 1024))
                for token in frames.feed(data):
                    try:
                        entry = on_scan(token)
                        with self._lock:
                            self._status["scan_count"] += 1
                            self._status["revision"] += 1
                            self._status["last_entry_id"] = entry["id"]
                            self._status["last_student"] = entry["student"]["display_name"]
                            self._status["last_error"] = None
                    except Exception as error:
                        detail = getattr(error, "detail", None)
                        with self._lock:
                            self._status["revision"] += 1
                            self._status["last_entry_id"] = None
                            self._status["last_student"] = None
                            self._status["last_error"] = str(detail or error)
        except Exception as error:
            if not self._stop.is_set():
                with self._lock:
                    self._status["last_error"] = f"Scanner disconnected: {error}"
                    self._status["revision"] += 1
        finally:
            try:
                scanner.close()
            except Exception:
                pass
            with self._lock:
                if self._serial is scanner:
                    self._serial = None
                    self._status["connected"] = False

    def disconnect(self):
        self._stop.set()
        with self._lock:
            scanner = self._serial
            thread = self._thread
            self._serial = None
            self._thread = None
            self._status["connected"] = False
            self._status["mode"] = None
        if scanner is not None:
            try:
                scanner.close()
            except Exception:
                pass
        if thread and thread.is_alive():
            thread.join(timeout=2)
        return self.status()


scanner_service = SerialScannerService()
