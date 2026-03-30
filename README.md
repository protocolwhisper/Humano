# ProofCam Mini App Template

World App Mini App starter for a proof-gated camera flow:

- Device proof is the default unlock path.
- Orb human proof is available as the stronger option.
- Users can take a photo after verification.
- Photos are stored locally inside the app with IndexedDB.
- A browser-only dev bypass is included so you can keep building before real World credentials are ready.

## What this template covers

This template is aimed at the hackathon flow you described:

1. Open a World App Mini App on mobile.
2. Verify with World ID.
3. Unlock the camera.
4. Capture a photo.
5. Keep that photo stored inside the app.

It also keeps the two proof tracks separate:

- `NEXT_PUBLIC_WORLD_ACTION_DEVICE`
- `NEXT_PUBLIC_WORLD_ACTION_HUMAN`

That makes it easy to demo device proof by default while still showing a meaningful proof-of-personhood path with Orb verification.

## Stack

- Next.js App Router
- React 19
- `@worldcoin/minikit-js`
- IndexedDB for local photo storage

## Setup

Copy the environment template:

```bash
cp .env.example .env.local
```

Install dependencies:

```bash
pnpm install
```

Start the app:

```bash
pnpm dev
```

## Environment variables

```env
APP_ID=app_replace_me
NEXT_PUBLIC_WORLD_ACTION_DEVICE=photo-device-proof
NEXT_PUBLIC_WORLD_ACTION_HUMAN=photo-human-proof
NEXT_PUBLIC_ALLOW_DEV_BYPASS=true
```

### `APP_ID`

Server-side World Developer Portal app id. The `/api/verify` route uses this to verify the proof on the backend.

### `NEXT_PUBLIC_WORLD_ACTION_DEVICE`

Your device proof action id.

### `NEXT_PUBLIC_WORLD_ACTION_HUMAN`

Your Orb human proof action id.

### `NEXT_PUBLIC_ALLOW_DEV_BYPASS`

Temporary browser-only shortcut while you wait for real credentials. Keep this `true` for local UI work if needed, then switch it to `false` before a real demo or submission.

## How verification works

The client calls `MiniKit.verifyAsync(...)` with:

- the selected action id
- the proof level
- a generated signal

The returned proof payload is then forwarded to [`app/api/verify/route.ts`](/Users/protocolwhisper/Documents/Working%20Dir/plhackathon/app/api/verify/route.ts), where `verifyCloudProof(...)` validates it on the server.

## Camera flow

This template offers two capture paths:

1. Live preview via `navigator.mediaDevices.getUserMedia(...)`
2. Fallback quick capture via `<input type="file" accept="image/*" capture="environment">`

That fallback is useful on mobile webviews and simulator environments where live preview can be inconsistent.

## Local storage

Captured photos are stored in IndexedDB through [`lib/photo-store.ts`](/Users/protocolwhisper/Documents/Working%20Dir/plhackathon/lib/photo-store.ts). The gallery is rendered from local app storage, so photos remain available after refresh on the same device until the user clears them.

## World App testing

MiniKit commands only work inside World App. For a real proof flow:

1. Expose your local app with a tunnel like `ngrok`.
2. Register that URL in the World Developer Portal.
3. Open the URL inside World App or the simulator.
4. Turn off `NEXT_PUBLIC_ALLOW_DEV_BYPASS` once you have real credentials in place.

## Submission note

This template covers the Mini App, human/device verification flow, and mobile photo storage. For the hackathon submission, you still need to:

- plug in your real `APP_ID` and action ids
- deploy the app publicly
- host the repo publicly
- add your final World Chain deployment story if you want the app to anchor state or monetization onchain

## Useful docs

- [World docs home](https://docs.world.org/)
- [Mini App getting started](https://docs.world.org/mini-apps/quick-start/installing)
- [Mini App verify command](https://docs.world.org/mini-apps/commands/verify)
- [Mini App response handling](https://docs.world.org/mini-apps/quick-start/responses)
