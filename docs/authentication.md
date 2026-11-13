# Authentication

Odeon has no passwords. The administrator creates users in Navidrome and sends each one an invite link (Settings, Users). A link works once and expires after 48 hours. Opening it creates a passkey, and later sign-ins use that passkey.

## How it works

Odeon signs the user in to Navidrome with the `Remote-User` header. Navidrome must trust that header only from Odeon's address, over a private network nothing else joins (`ND_EXTAUTH_TRUSTEDSOURCES`). The returned Subsonic token and salt are stored on the device. `docker-compose.example.yml` shows the network setup.

The first invite comes from the command line, for a Navidrome administrator:

```sh
docker exec odeon node src/invite.ts <navidrome-admin-username>
```

## Locking someone out

Delete the user or change their password in Navidrome. That invalidates their token, and a re-created user with the same name cannot use the old passkeys.

## Devices without passkeys

Devices that cannot use passkeys, like the Android 4.2 car app in `android/`, sign in with a code. The device shows the code, and a signed-in user enters it under Settings, Sign-in and security, Link a device.

Several accounts can be saved on one device and switched from the "Who's listening?" screen.

## Remote control

The car app reports what it plays to `/api/remote` and long-polls for commands. Odeon on the same account's other devices shows it under the devices button in the player and can pause, skip, seek, jump in the queue or send its own queue there.
