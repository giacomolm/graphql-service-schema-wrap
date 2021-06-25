const { print } = require('graphql');
const { introspectSchema, wrapSchema } = require('@graphql-tools/wrap');
const { ApolloServer } = require('apollo-server-cloudflare')
const { graphqlCloudflare } = require('apollo-server-cloudflare/dist/cloudflareApollo')

const executor = async ({ document, variables }) => {
  const query = print(document);
  const fetchResult = await fetch('https://graphql.eng-demo.bloomreach.io/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'connector': 'brsm',
    },
    body: JSON.stringify({ query, variables }),
  });
  return fetchResult.json();
};

const createServer = async (graphQLOptions) => {
  const schema = wrapSchema({
    schema: await introspectSchema(executor),
    executor,
  });
  return new ApolloServer({ schema });
}

let server = undefined;
const handler = async (request, graphQLOptions) => {
  //lazy init
  if (server === undefined) {
    server =  await createServer(graphQLOptions);
  }
  return graphqlCloudflare(() => server.createGraphQLServerOptions(request))(request)
}

module.exports = handler