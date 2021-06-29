const graphqlService = require("@bloomreach/graphql-commerce-connector-service");
const { print } = require('graphql');
const { ApolloServer } = require('apollo-server');
const jose = require('node-jose');
const { introspectSchema, wrapSchema } = require('@graphql-tools/wrap');
const { mergeSchemas } = require('@graphql-tools/merge');
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

const getAccessData = async(authorization) => {
  const encryptedAccessData = authorization?.substring('Bearer '.length);
  let accessData;
  if (encryptedAccessData) {
    try {
      const jwk = await jose.JWK.asKeyStore(keystore);
      const { payload } = await jose.JWE.createDecrypt(jwk).decrypt(encryptedAccessData);
      return JSON.parse(payload.toString());
    } catch (e) {
      throw new Error(`Invalid authorization: ${e}`);
    }
  }
}

const createServer = async (request) => {
  const remoteSchema = wrapSchema({
    schema: await introspectSchema(gsExecutor),
    executor: gsExecutor,
  });

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
      payments: async (parent, args, context) => {
        const accessData = await getAccessData(context.authorization);
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
      makePayment: async (parent, args, context) => {
        const accessData = await getAccessData(context.authorization);
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

  return new ApolloServer({
    schema: mergedSchema,
    context: ({ req }) => ({
      authorization: req.headers.authorization,
      connector: req.headers.connector
    }) 
  });
}

async function startApolloServer() {
  const server = await createServer();
  // The `listen` method launches a web server.
  server.listen({ port: 4100 }).then(({ url }) => {
    console.log(`🚀  Server ready at ${url}`);
  });
}

startApolloServer();