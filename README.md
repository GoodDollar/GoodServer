
# GoodDollar API Server
[![Build Status](https://travis-ci.com/GoodDollar/GoodServer.svg?branch=master)](https://travis-ci.com/GoodDollar/GoodServer)
[![Coverage Status](https://coveralls.io/repos/github/GoodDollar/GoodServer/badge.svg?branch=master)](https://coveralls.io/github/GoodDollar/GoodServer?branch=master)


Setup
--
- copy env.example to .env
- choose network kovan/truffle (see below how to setup local truffle node)
- fill the mnemonic that was used to deploy contracts

Local Node
--
- clone @gooddollar/goodcontracts
- run `truffle develop`
- in console type `migrate --reset`
