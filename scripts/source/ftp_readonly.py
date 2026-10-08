"""Read-only FTPS inventory. Password is accepted on a non-echoing terminal."""
import ftplib
import getpass
import json
import socket
import ssl
import sys

HOST = "host10.e-kei.pl"
EXPECTED_ADDRESS = "94.152.13.10"
ACCOUNT = "plonka"


class ReadOnlyFTP(ftplib.FTP_TLS):
    ALLOWED = {
        "AUTH", "USER", "PASS", "PBSZ", "PROT", "TYPE", "EPSV", "PASV",
        "PWD", "CWD", "CDUP", "MLSD", "LIST", "NLST", "SIZE", "MDTM",
        "RETR", "QUIT", "FEAT", "OPTS", "SYST", "NOOP",
    }

    def putcmd(self, line):
        command = line.split(" ", 1)[0].upper()
        if command not in self.ALLOWED:
            raise PermissionError("Source FTP mutations are forbidden.")
        return super().putcmd(line)

    def storbinary(self, *args, **kwargs):
        raise PermissionError("Source FTP uploads are forbidden.")

    def storlines(self, *args, **kwargs):
        raise PermissionError("Source FTP uploads are forbidden.")


def main():
    if socket.gethostbyname(HOST) != EXPECTED_ADDRESS:
        raise RuntimeError("Source hostname does not resolve to the authorized server.")
    password = getpass.getpass("FTPS password: ")
    ftp = ReadOnlyFTP(context=ssl.create_default_context(), timeout=20)
    stage = "connect"
    try:
        ftp.connect(HOST, 21)
        stage = "login"
        ftp.login(ACCOUNT, password)
        del password
        stage = "data-protection"
        ftp.prot_p()
        stage = "inventory"
        try:
            entries = list(ftp.mlsd())
        except ftplib.error_perm as error:
            if str(error)[:3] not in {"500", "502"}:
                raise
            # Legacy servers may not implement RFC 3659. LIST remains read-only.
            lines = []
            ftp.retrlines("LIST", lines.append)
            entries = []
            for line in lines:
                parts = line.split(None, 8)
                if len(parts) != 9 or parts[0][0] not in {"d", "-", "l"}:
                    continue
                name = parts[8]
                if name in {".", ".."}:
                    continue
                entries.append((name, {
                    "type": {"d": "dir", "-": "file", "l": "symlink"}[parts[0][0]],
                    "size": parts[4],
                }))
        print(json.dumps({
            "connected": True,
            "tls_verified": True,
            "root": ftp.pwd(),
            "entries": [{"name": name, "type": facts.get("type"), "size": facts.get("size")} for name, facts in entries],
        }))
    except Exception as error:
        code = str(error)[:3]
        print(json.dumps({
            "connected": False,
            "stage": stage,
            "error_type": type(error).__name__,
            "error_code": code if code.isdigit() else None,
        }))
        sys.exit(1)
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"connected": False, "error_type": type(error).__name__}))
        sys.exit(1)
