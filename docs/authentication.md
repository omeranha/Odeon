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

## Adding another device

A user who is already signed in can add a new device without asking the administrator for an invite link. On the new device, choose Sign in with a code on the login screen. It shows a code, and the signed-in user enters it under Settings, Sign-in and security, Link a device. The code works once and expires after 3 minutes. The approval screen shows when the code was requested and warns if it came from a different network than the approver's. The device chooses its own name, so the name proves nothing: never approve a code someone else sent you. The same flow signs in devices that cannot use passkeys, like the Android 4.2 car app in `android/`.

A device signed in this way holds a login but no passkey of its own. It can add one under Settings, Sign-in and security. An invite link is only needed when the user has no signed-in device left.

Several accounts can be saved on one device and switched from the "Who's listening?" screen.

## Remote control

The car app reports what it plays to `/api/remote` and long-polls for commands. Odeon on the same account's other devices shows it under the devices button in the player and can pause, skip, seek, jump in the queue or send its own queue there.
