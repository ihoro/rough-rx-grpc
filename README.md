# The simplest RxJS wrapper around grpc lib

[![Build Status](https://travis-ci.com/ihoro/rough-rx-grpc.svg?branch=master)](https://travis-ci.com/ihoro/rough-rx-grpc)
[![npm version](https://badge.fury.io/js/%40rough%2Frx-grpc.svg)](https://badge.fury.io/js/%40rough%2Frx-grpc)

Rough implementation of [rxified](https://npmjs.com/rxjs) wrapper and tools for [grpc](https://npmjs.com/grpc) lib.

## Usage example

```proto
// GreetingService.proto

syntax = "proto3";

package org.example;

service GreetingService {
  rpc Greet(Request) returns (Response);
}

message Request {
  string name = 1;
}

message Response {
  string message = 1;
}
```

```js
// server.js

class GreetingService {
  Greet(call, callback) {
    const name = call.request.name;
    if (name)
      callback(null, { message: `Hello, ${name}!` });
    else
      callback(new Error('Name is not defined.'));
  }
}

const RxGrpc = require('@rough/rx-grpc');
new RxGrpc()
  .withProtoFiles(__dirname + '/*.proto')
  .serve('org.example.GreetingService', new GreetingService())
  .startServer()
  .subscribe(
    started => console.log('Listening at grpc://0.0.0.0:50051 ...'),
    err => console.log(err),
    complete => {}
  );
```

```js
// client.js

const { flatMap } = require('rxjs/operators');
const RxGrpc = require('@rough/rx-grpc');

const rxgrpc = new RxGrpc().withProtoFiles(__dirname + '/*.proto');

const name = (process.argv.length > 2) ? process.argv[2] : null;

rxgrpc.service('org.example.GreetingService', 'localhost:50051').pipe(
  flatMap(GreetingService => GreetingService.Greet({ name }))
)
.subscribe(
  response => console.log(response.message),
  err => console.log(err),
  complete => {}
);
```
