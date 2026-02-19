#!/bin/bash
set -e  # Exit on error

cp -R node_modules/@gooddollar/goodprotocol /tmp
pushd /tmp/goodprotocol
export CI=false
export MNEMONIC='test test test test test test test test test test test junk'
export ADMIN_MNEMONIC='test test test test test test test test test test test junk'
export YARN_ENABLE_IMMUTABLE_INSTALLS=false
yarn set version 3.6.1
yarn config set enableImmutableInstalls false
echo "nodeLinker: node-modules" > .yarnrc.yml
yarn
echo "Starting blockchain node..."
# Start node in background and disown it so it persists after script exits
nohup yarn runNode > /tmp/blockchain-node.log 2>&1 &
NODE_PID=$!
echo "Blockchain node started with PID: $NODE_PID"

# Wait for the node to be ready (check if port 8545 is listening)
echo "Waiting for blockchain node to be ready..."
MAX_WAIT=120
WAIT_COUNT=0
while ! (curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://localhost:8545 > /dev/null 2>&1); do
  if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
    echo "Error: Blockchain node failed to start within ${MAX_WAIT} seconds"
    kill $NODE_PID 2>/dev/null || true
    exit 1
  fi
  sleep 2
  WAIT_COUNT=$((WAIT_COUNT + 2))
done

# Additional wait to ensure node is fully initialized
sleep 5

echo "Blockchain node is ready. Deploying contracts..."
if ! yarn deployTest; then
  echo "Error: Contract deployment failed"
  kill $NODE_PID 2>/dev/null || true
  exit 1
fi

echo "Minimizing contracts..."
if ! yarn minimize; then
  echo "Warning: Contract minimization failed, continuing anyway"
fi

popd
cp -R /tmp/goodprotocol/artifacts node_modules/@gooddollar/goodprotocol/
cp -R /tmp/goodprotocol/releases node_modules/@gooddollar/goodprotocol/

# Verify contracts were deployed by checking if releases file exists and has content
if [ ! -f "node_modules/@gooddollar/goodprotocol/releases/deployment.json" ]; then
  echo "Error: Deployment file not found after setup"
  kill $NODE_PID 2>/dev/null || true
  exit 1
fi

# Verify the node is still running and responding
echo "Verifying blockchain node is still responsive..."
if ! (curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://localhost:8545 > /dev/null 2>&1); then
  echo "Error: Blockchain node stopped responding after deployment"
  exit 1
fi

# Get the latest block number to verify node is working
LATEST_BLOCK=$(curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://localhost:8545 | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
echo "Blockchain setup complete. Node PID: $NODE_PID, Latest block: $LATEST_BLOCK"

# Verify node process is still running
if ! kill -0 $NODE_PID 2>/dev/null; then
  echo "Error: Blockchain node process died!"
  cat /tmp/blockchain-node.log 2>/dev/null || true
  exit 1
fi

# Don't exit with error on background process - let it keep running
set +e
