"""Forward serial QR scans to the local web queue; never generate/play speech here."""
import argparse
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlparse


class ScanFrames:
    """Handle CR, LF, or CRLF framing, including split reads and oversized input."""
    def __init__(self):
        self.buffer = bytearray()
        self.discarding = False

    def feed(self, data):
        tokens = []
        for byte in data:
            if byte in (10, 13):
                if self.buffer and not self.discarding:
                    try:
                        token = self.buffer.decode("utf-8").strip()
                        if token:
                            tokens.append(token)
                    except UnicodeDecodeError:
                        pass
                self.buffer.clear()
                self.discarding = False
            elif not self.discarding:
                self.buffer.append(byte)
                if len(self.buffer) > 256:
                    self.buffer.clear()
                    self.discarding = True
        return tokens


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list-ports", action="store_true")
    parser.add_argument("--port", help="e.g. /dev/cu.usbmodemA_000001 or COM3")
    parser.add_argument("--baud", type=int, default=9600)
    parser.add_argument("--ceremony", type=int)
    parser.add_argument("--server", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    try:
        import serial
        from serial.tools import list_ports
    except ImportError:
        parser.exit(1, "Install requirements-integrations.txt first.\n")
    if args.list_ports:
        for port in list_ports.comports():
            print(f"{port.device}: {port.description}")
        return
    if not args.port or not args.ceremony:
        parser.error("--port and --ceremony are required")
    server = urlparse(args.server)
    if server.scheme != "http" or server.hostname not in {"127.0.0.1", "localhost", "::1"} or server.username or server.query or server.fragment or server.path not in {"", "/"}:
        parser.error("--server must be a local loopback HTTP address")
    endpoint = f"{args.server.rstrip('/')}/api/ceremonies/{args.ceremony}/scan"
    try:
        with urlopen(f"{args.server.rstrip('/')}/api/ceremonies/{args.ceremony}", timeout=5) as response:
            ceremony = json.load(response)
        print(f"Checking in to: {ceremony['name']} (ID {args.ceremony}). Ctrl+C to stop.")
        with serial.Serial(args.port, args.baud, timeout=0.5) as scanner:
            frames = ScanFrames()
            while True:
                for token in frames.feed(scanner.read(min(scanner.in_waiting or 1, 1024))):
                    request = Request(endpoint, data=json.dumps({"token": token}).encode(),
                                      headers={"Content-Type": "application/json"}, method="POST")
                    try:
                        with urlopen(request, timeout=5) as response:
                            entry = json.load(response)
                        print(f"Checked in: {entry['student']['display_name']} (repeated scans are harmless)")
                    except HTTPError as error:
                        print(f"Scan not accepted: {json.load(error).get('detail', 'Unknown error')}. Check the stage screen.")
                    except (URLError, TimeoutError):
                        print("Cannot confirm check-in. Check the server and rescan; no automatic retry.")
    except KeyboardInterrupt:
        print("\nScanner disconnected.")
    except (serial.SerialException, URLError, TimeoutError, ValueError) as error:
        parser.exit(1, f"Scanner bridge stopped: {error}\n")


if __name__ == "__main__":
    main()
