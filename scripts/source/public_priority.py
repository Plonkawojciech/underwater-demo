"""Capture known public sections first, encrypted, without touching crawl state."""
import hashlib
import json
import os
import pathlib
import time
from datetime import datetime, timezone
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from keychain import snapshot_key
from inventory import encrypted_write, decrypt_manifest
from public_capture import get

DEST = pathlib.Path.home() / 'Programo/underwater-private/20261008-priority'
PATHS = ['/', '/kursy-nurkowania/padi-open-water-diver.html', '/kursy-nurkowania/padi-advanced-open-water-diver.html', '/kursy-nurkowania/padi-rescue-diver.html', '/kursy-nurkowania/kursy-nurkowania-padi-warszawa.html', '/wyprawy-nurkowe.html', '/kalendarz.html', '/aktualnosci.html', '/relacje-z-wypraw.html', '/galeria.html', '/centrum-nurkowe.html', '/kontakt.html', '/serwis-sprzetu-nurkowego.html', '/3625-maska-soprastek-corona.html', '/sklep-nurkowy/80-maski-i-fajki/3625-maska-soprastek-corona.html']

def main():
    key = snapshot_key(); DEST.mkdir(parents=True, exist_ok=True, mode=0o700); os.chmod(DEST, 0o700)
    objects=DEST/'objects'; objects.mkdir(exist_ok=True,mode=0o700)
    target=DEST/'pages-manifest.enc'
    state=decrypt_manifest(target,key) if target.exists() else {'source_type':'public-GET-priority','database_snapshot':False,'started_at':datetime.now(timezone.utc).isoformat(),'files':[],'failed':[]}
    for suffix in PATHS:
        url='https://www.underwater.pl'+suffix
        if any(row['url']==url for row in state['files']): continue
        try:
            body,final,charset=get(url); nonce=os.urandom(12); name=hashlib.sha256(url.encode()).hexdigest()+'.enc'
            path=objects/name; path.write_bytes(b'UWENC1'+nonce+AESGCM(key).encrypt(nonce,body,url.encode())); os.chmod(path,0o600)
            state['files'].append({'url':url,'final_url':final,'object':name,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'charset':charset})
        except Exception as error: state['failed'].append({'url':url,'error_type':type(error).__name__})
        encrypted_write(target,state,key); time.sleep(0.7)
    state['finished_at']=datetime.now(timezone.utc).isoformat(); encrypted_write(target,state,key)
    print(json.dumps({'captured':len(state['files']),'failed':len(state['failed']),'database_snapshot':False}),flush=True)

if __name__=='__main__': main()
