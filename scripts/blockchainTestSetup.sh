#!/bin/bash
pushd node_modules/@gooddollar/goodprotocol
export CI=false
yarn
yarn deployTest
popd