# ProofCam

World App Mini App template with:

- device proof by default
- Orb human proof option
- camera capture after verification
- local photo storage inside the app
- optional Filecoin Calibration upload with Synapse SDK

## Run locally

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

## Env

```env
APP_ID=app_replace_me
NEXT_PUBLIC_WORLD_ACTION_DEVICE=photo-device-proof
NEXT_PUBLIC_WORLD_ACTION_HUMAN=photo-human-proof
NEXT_PUBLIC_ALLOW_DEV_BYPASS=true
FILECOIN_WALLET_PRIVATE_KEY=0xreplace_me
FILECOIN_RPC_URL=https://api.calibration.node.glif.io/rpc/v1
```

## How it works

1. User opens the mini app.
2. World App generates a proof payload for the requested action.
3. Device proof is the default option.
4. The server verifies that proof.
5. The app turns the verified result into an allow-camera decision.
6. The photo is saved locally in IndexedDB.
7. The photo can be uploaded to Filecoin Calibration.

## Important

- `NEXT_PUBLIC_ALLOW_DEV_BYPASS=true` is only for local development.
- Replace `APP_ID` and action ids with your real World credentials before demo/submission.
- Real verification works inside World App or the simulator.
- Filecoin upload needs a funded Calibration wallet in `FILECOIN_WALLET_PRIVATE_KEY`.

## Still needed for submission

- add real World credentials
- fund and configure the Filecoin Calibration wallet
- deploy publicly
- connect the final World Chain part if needed
- push this repo to GitHub

## Docs

- [World Docs](https://docs.world.org/)
