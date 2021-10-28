# GoodDollar API Server

We use
[<img valign="middle" src="https://www.datocms-assets.com/31049/1618983297-powered-by-vercel.svg?raw=true&sanitize=1" width="100px"/>](https://vercel.com/?utm_source=[team-name]&utm_campaign=oss)

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
