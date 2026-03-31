#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${FILECOIN_RPC_URL:-https://api.calibration.node.glif.io/rpc/v1}"
PRIVATE_KEY="${HUMANO_PROTOCOL_DEPLOYER_PRIVATE_KEY:-${FILECOIN_WALLET_PRIVATE_KEY:-}}"

if [[ -z "${PRIVATE_KEY}" ]]; then
  echo "Missing HUMANO_PROTOCOL_DEPLOYER_PRIVATE_KEY or FILECOIN_WALLET_PRIVATE_KEY"
  exit 1
fi

forge create \
  contracts/HumanoProtocol.sol:HumanoProtocol \
  --rpc-url "${RPC_URL}" \
  --private-key "${PRIVATE_KEY}" \
  --broadcast

