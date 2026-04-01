# HUMANO

World App mini app for:

- World ID login
- verified camera capture
- local feed + profile
- optional Filecoin Calibration sync
- optional Humano onchain tracking

## Open the app

Live app:

- [https://humano-neon.vercel.app/](https://humano-neon.vercel.app/)

Scan this QR on your phone:

![Humando app QR](https://api.qrserver.com/v1/create-qr-code/?size=345x240&data=https%3A%2F%2Fhumano-neon.vercel.app%2F)

## Run locally

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

## Env

```env
APP_ID=app_replace_me
RP_ID=rp_replace_me
DATABASE_URL=postgresql://user:password@host:5432/database

NEXT_PUBLIC_WORLD_ACTION_DEVICE=unlock-camera-device
NEXT_PUBLIC_WORLD_ACTION_HUMAN=unlock-camera-human
NEXT_PUBLIC_ALLOW_DEV_BYPASS=false

FILECOIN_WALLET_PRIVATE_KEY=0xreplace_me
FILECOIN_RPC_URL=https://api.calibration.node.glif.io/rpc/v1
HUMANO_PROTOCOL_CONTRACT_ADDRESS=0xreplace_me
```

## Notes

- real verification works inside World App
- photos stay local first, then can sync to Filecoin
- metadata is stored in Postgres
- Filecoin sync uses Calibration testnet
