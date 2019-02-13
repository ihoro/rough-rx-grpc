'use strict';

const glob = require('glob');
const grpc = require('grpc');
const protoLoader = require('@grpc/proto-loader');
const { Observable, from, of } = require('rxjs');
const { flatMap, map, count, tap } = require('rxjs/operators');

const DEFAULT_OPTIONS = {
  protoLoader: {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  }
};

let _sharedInstance = null;

module.exports = class RxGrpc {
  constructor(protoFileGlobs, options) {
    this.grpc = grpc;

    this.protoFileGlobs = [];
    this.protos = [];
    this.servicesToServe = [];
    this.serviceClients = {};

    this.withProtoFiles(protoFileGlobs);
    this.withOptions(options);
  }

  static sharedInstance() {
    if (! _sharedInstance)
      _sharedInstance = new RxGrpc();
    return _sharedInstance;
  }

  withProtoFiles(protoFileGlobs) {
    if (!protoFileGlobs)
      return this;

    if (Array.isArray(protoFileGlobs))
      this.protoFileGlobs = protoFileGlobs;
    else
      this.protoFileGlobs = [ protoFileGlobs ];
    return this;
  }

  withOptions(options) {
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);
    return this;
  }

  service(serviceFqn, socket, creds) {
    return this._loadProtos().pipe(
      map(_ => this._service(serviceFqn, socket, creds)),
    );
  }

  _service(serviceFqn, socket, creds) {
    let client = this.serviceClients[serviceFqn];
    if (client)
      return client;

    const serviceDefinition = this._getServiceDefinition(serviceFqn);
    if (! serviceDefinition)
      throw new Error(`Service definition for service '${serviceFqn}' not found.`);

    if (! socket) {
      const host = process.env[serviceFqn + '_HOST'];
      const port = process.env[serviceFqn + '_PORT'];
      if (!host || !port)
        socket = 'localhost:50051';
      else
        socket = host + ':' + port;
    }

    if (! creds)
      creds = grpc.credentials.createInsecure();

    client = new serviceDefinition(socket, creds);
    client = this._wrapClient(client);
    this.serviceClients[serviceFqn] = client;
    return client;
  }

  _wrapClient(client) {
    return new Proxy({}, {
      get: (target, property, receiver) => {
        const serviceMethod = client[property];
        if (typeof serviceMethod !== 'function')
          throw new Error(`${property.toString()} service method not found.`);
        return this._wrapServiceMethod(client, serviceMethod);
      }
    });
  }

  _wrapServiceMethod(client, serviceMethod) {
    return (...args) => {
      return Observable.create(observer => {
        const callback = (err, response) => {
          if (err)
            return observer.error(err);
          observer.next(response);
          observer.complete();
        };
        serviceMethod.apply(client, [ ...args, callback ]);
      });
    };
  }

  serve(serviceFqn, serviceImplementation) {
    this.servicesToServe.push({ serviceFqn, serviceImplementation });
    return this;
  }

  // TODO: implement correct observer.next signal - upon http2 server start
  // TODO: implement observer.complete signal - upon http2 server stop
  startServer(socket, creds) {
    if (!socket)
      socket = '0.0.0.0:50051';
    if (!creds)
      creds = grpc.ServerCredentials.createInsecure();
    return this._loadProtos().pipe(
      tap(_ => this.server = new grpc.Server()),
      flatMap(_ => from(this.servicesToServe)),
      tap(serviceToServe => {
        const serviceDefinition = this._getServiceDefinition(serviceToServe.serviceFqn);
        if (! serviceDefinition)
          throw new Error(`Service definition for service '${serviceToServe.serviceFqn}' not found.`);
        this.server.addService(serviceDefinition.service, serviceToServe.serviceImplementation);
      }),
      count(),
      tap(_ => {
        this.server.bind(socket, creds);
        this.server.start();
      }),
    );
  }

  _getServiceDefinition(serviceFqn) {
    for (let proto of this.protos) {
      let obj = proto;
      for (let node of serviceFqn.split('.')) {
        obj = obj[node];
        if (!obj)
          break;
      }
      if (obj)
        return obj;
    }
    return null;
  }

  _loadProtos() {
    if (this.protoFileGlobs.length === 0)
      return of(this);

    return this._scanProtoFileGlobs(this.protoFileGlobs).pipe(
      flatMap(protoFile => this._loadProto(protoFile)),
      count(),
      tap(_ => this.protoFileGlobs = []),
    );
  }

  _loadProto(protoFilePath) {
    return from(protoLoader.load(protoFilePath, this.options.protoLoader)).pipe(
      map(packageDefinition => grpc.loadPackageDefinition(packageDefinition)),
      tap(proto => this.protos.push(proto)),
    );
  }

  _scanProtoFileGlobs(protoFileGlobs) {
    return from(protoFileGlobs).pipe(
      flatMap(this._scanProtoFileGlob)
    );
  }

  _scanProtoFileGlob(protoFileGlob) {
    return Observable.create(observer => {
      glob(protoFileGlob, (err, files) => {
        if (err)
          return observer.error(err);
        files.forEach(file => observer.next(file));
        observer.complete();
      });
    });
  }
};
