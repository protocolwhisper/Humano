# ProofCam

World App Mini App template with:

- device proof by default
- Orb human proof option
- camera capture after verification
- local photo storage inside the app
- optional Filecoin Calibration upload with Synapse SDK
- optional FEVM contract tracking with Foundry + Humano Protocol

## Run locally

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

## Env

```env
APP_ID=app_replace_me
NEXT_PUBLIC_WORLD_ACTION_DEVICE=unlock-camera-device
NEXT_PUBLIC_WORLD_ACTION_HUMAN=unlock-camera-human
NEXT_PUBLIC_ALLOW_DEV_BYPASS=true
FILECOIN_WALLET_PRIVATE_KEY=0xreplace_me
FILECOIN_RPC_URL=https://api.calibration.node.glif.io/rpc/v1
HUMANO_PROTOCOL_CONTRACT_ADDRESS=0xreplace_me
```

## How it works

1. User opens the mini app.
2. World App generates a proof payload for the camera-unlock action.
3. Device proof is the default option.
4. The server verifies that proof.
5. The app turns the verified result into a camera-session unlock.
6. The user can take multiple photos in that verified session.
7. Each photo is saved locally in IndexedDB.
8. Each photo can also be uploaded to Filecoin Calibration.
9. Each Filecoin-backed photo can be recorded onchain in `humano_protocol`.

## UI flow

- `Local saved` means the image is in the mini app gallery.
- `Filecoin synced` means the image bytes are stored on Filecoin Calibration.
- `Humano tracked` means the Filecoin-backed image was also recorded onchain in the `humano_protocol` contract.

## Important

- `NEXT_PUBLIC_ALLOW_DEV_BYPASS=true` is only for local development.
- Replace `APP_ID` and action ids with your real World credentials before demo/submission.
- Real verification works inside World App or the simulator.
- Filecoin upload needs a funded Calibration wallet in `FILECOIN_WALLET_PRIVATE_KEY`.
- Onchain tracking needs `HUMANO_PROTOCOL_CONTRACT_ADDRESS` after you deploy the contract.

## Foundry deploy

Build the contract:

```bash
forge build
```

Deploy to Calibration:

```bash
bash script/deploy-humano-protocol.sh
```

After deploy, copy the contract address into:

```env
HUMANO_PROTOCOL_CONTRACT_ADDRESS=0x...
```

## Still needed for submission

- add real World credentials
- fund and configure the Filecoin Calibration wallet
- deploy `humano_protocol` to Calibration
- deploy publicly
- connect the final World Chain part if needed
- push this repo to GitHub

## Docs

- [World Docs](https://docs.world.org/)
