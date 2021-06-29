const { print } = require('graphql');
const jose = require('node-jose');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { introspectSchema, wrapSchema } = require('@graphql-tools/wrap');
const { mergeSchemas } = require('@graphql-tools/merge');
const { ApolloServer } = require('apollo-server-cloudflare')
const { graphqlCloudflare } = require('apollo-server-cloudflare/dist/cloudflareApollo');

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

const createServer = async (request) => {
  const { authorization, connector } = Object.fromEntries(request.headers);
  const context = { authorization, connector };
  const remoteSchema = wrapSchema({
    schema: await introspectSchema(gsExecutor, context),
    executor: gsExecutor,
  });

  const encryptedAccessData = authorization.substring('Bearer '.length);
  let accessData;
  if (encryptedAccessData) {
    try {
      const jwk = await jose.JWK.asKeyStore(keystore);
      const { payload } = await jose.JWE.createDecrypt(jwk).decrypt(encryptedAccessData);
      accessData = JSON.parse(payload.toString());
    } catch (e) {
      throw new Error(`Invalid authorization: ${e}`);
    }
  }

  const typeDefs = `
    type CustomPayment {
      id: String!
    }

    type Query {
      payments: [CustomPayment]
    }

    input PaymentInput {
      moneyAmount: Float
    }

    type Mutation {
      makePayment(paymentInput: PaymentInput): CustomPayment
    }
  `;

  const resolvers = {
    Query: {
      payments: async () => {
        const headers =  {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessData.accessToken.access_token}`,
        };
        const fetchResult = await fetch('https://api.europe-west1.gcp.commercetools.com/<key>/me/payments', {
          method: 'GET',
          headers,
        });
        const { results } = await fetchResult.json();
        return results;
      }
    },

    Mutation: {
      makePayment: async (paymentInput) => {
        const headers =  {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessData.accessToken.access_token}`,
        };
        const fetchResult = await fetch('https://api.europe-west1.gcp.commercetools.com/<key>/me/payments', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            "amountPlanned": {
              "currencyCode": "EUR",
              "centAmount": 4200
            }
          }),
        });
        return fetchResult.json();
      }
    },

    CustomPayment: {
      id: payment => payment.id,
    },

  };

  const paymentSchema = makeExecutableSchema({ typeDefs, resolvers });

  const mergedSchema = mergeSchemas({
    schemas: [remoteSchema, paymentSchema]
  });

  return new ApolloServer({ schema: mergedSchema, context });
}

const handler = async (request) => {
  const server =  await createServer(request);

  return graphqlCloudflare(() => server.createGraphQLServerOptions(request))(request)
}

module.exports = handler