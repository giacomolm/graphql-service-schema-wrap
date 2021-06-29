const express = require('express')
const { print } = require('graphql');
const { find, filter } = require('lodash');
const jose = require('node-jose');
const { introspectSchema, wrapSchema, RenameTypes } = require('@graphql-tools/wrap');
const { stitchSchemas } = require('@graphql-tools/stitch');
const { ApolloServer } = require('apollo-server-express')
const { graphqlCloudflare } = require('apollo-server-cloudflare/dist/cloudflareApollo');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const fetch = require("node-fetch");

const keystore = {"keys": [{"alg": "A256GCM","k": "...","kid": "...","kty": "oct"}]};

const gsExecutor = async ({ document, variables, context }) => {
  const query = print(document);
  let headers =  {
    'Content-Type': 'application/json',
    'connector': 'brsm',
  };
  if (context) {
    if (context.connector) {
      headers = {
        ...headers,
        'connector': context.connector,
      }
    }
    if (context.authorization) {
      headers = {
        ...headers,
        'authorization': context.authorization,
      }
    }
  }
  const fetchResult = await fetch('http://localhost:4000/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  return fetchResult.json();
};

const ctExecutor = async ({ document, variables, context }) => {
  let headers =  {
    'Content-Type': 'application/json',
  };
  if (context) {
    if (context.authorization) {
      const encryptedAccessData = context.authorization.substring('Bearer '.length);
      let accessData;
      if (encryptedAccessData) {
        try {
          const jwk = await jose.JWK.asKeyStore(keystore);
          const { payload } = await jose.JWE.createDecrypt(jwk).decrypt(encryptedAccessData);
          accessData = JSON.parse(payload.toString());
          headers = {
            ...headers,
            'Authorization': `Bearer ${accessData.accessToken.access_token}`,
          }
        } catch (e) {
          throw new Error(`Invalid authorization: ${e}`);
        }
      }
    }
  }
  const query = print(document);
  const fetchResult = await fetch('https://api.europe-west1.gcp.commercetools.com/<key>/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  return fetchResult.json();
};

const createServer = async (request) => {
  const { authorization, connector } = request.headers;
  const context = { authorization, connector };
  const ctSchema = wrapSchema({
    schema: await introspectSchema(ctExecutor, context),
    executor: ctExecutor,
    transforms: [new RenameTypes(name => `CT${name}`)],
  });
  const gsSchema = wrapSchema({
    schema: await introspectSchema(gsExecutor, context),
    executor: gsExecutor,
  });

  const gatewaySchema = stitchSchemas({
    subschemas: [
      gsSchema,
      ctSchema,
    ]
  });

  return new ApolloServer({ schema: gatewaySchema, context });
}

async function startApolloServer() {
  let server = await createServer({
    headers: {
      authorization: 'Bearer $TOKEN',
      connector: 'brsm'
    }
  });
  const app = express();
  server.applyMiddleware({ app });

  app.use(async (req, res) => {
    res.status(200);
    res.send('Hello!');
    res.end();
  });

  await new Promise(resolve => app.listen({ port: 4100 }, resolve));
  console.log(`🚀 Server ready at http://localhost:4100`);
  return { server, app };
}

startApolloServer();