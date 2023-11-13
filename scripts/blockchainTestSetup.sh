#!/bin/bash
pushd node_modules/@gooddollar/goodprotocol
export CI=false
export MNEMONIC='test test test test test test test test test test test junk'
export ADMIN_MNEMONIC='test test test test test test test test test test test junk'
yarn set version 3.6.0
echo "nodeLinker: node-modules" >> .yarnrc.yml
yarn --immutable
yarn runNode
yarn deployTest
yarn minimize
popd
