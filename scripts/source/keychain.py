"""Keep source credentials and snapshot encryption keys in macOS Keychain."""
import ctypes
import ctypes.util
import getpass
import os

ACCOUNT = b"Underwater implementation"
FTP_SERVICE = "programo.underwater.source.ftp"
SNAPSHOT_SERVICE = "programo.underwater.source.snapshot-key"


def security():
    lib = ctypes.CDLL(ctypes.util.find_library("Security"))
    lib.SecKeychainFindGenericPassword.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32,
        ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint32),
        ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p,
    ]
    lib.SecKeychainFindGenericPassword.restype = ctypes.c_int32
    lib.SecKeychainAddGenericPassword.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32,
        ctypes.c_char_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_void_p,
    ]
    lib.SecKeychainAddGenericPassword.restype = ctypes.c_int32
    lib.SecKeychainItemFreeContent.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    return lib


def read_secret(service):
    lib = security()
    encoded = service.encode()
    length = ctypes.c_uint32()
    data = ctypes.c_void_p()
    status = lib.SecKeychainFindGenericPassword(
        None, len(encoded), encoded, len(ACCOUNT), ACCOUNT,
        ctypes.byref(length), ctypes.byref(data), None,
    )
    if status == -25300:
        return None
    if status:
        raise PermissionError("Keychain access failed; status " + str(status))
    try:
        return ctypes.string_at(data, length.value)
    finally:
        lib.SecKeychainItemFreeContent(None, data)


def add_secret(service, value):
    if read_secret(service) is not None:
        raise FileExistsError("Existing Keychain entry was preserved.")
    lib = security()
    encoded = service.encode()
    status = lib.SecKeychainAddGenericPassword(
        None, len(encoded), encoded, len(ACCOUNT), ACCOUNT, len(value), value, None,
    )
    if status:
        raise PermissionError("Keychain write failed; status " + str(status))


def snapshot_key():
    key = read_secret(SNAPSHOT_SERVICE)
    if key is None:
        key = os.urandom(32)
        add_secret(SNAPSHOT_SERVICE, key)
    if len(key) != 32:
        raise ValueError("Unexpected snapshot key format.")
    return key


if __name__ == "__main__":
    if read_secret(FTP_SERVICE) is None:
        add_secret(FTP_SERVICE, getpass.getpass("Verified FTPS password: ").encode())
    snapshot_key()
    print("Underwater credentials and snapshot key are available in Keychain; values were not printed.")
