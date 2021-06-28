const { print } = require('graphql');
const { find, filter } = require('lodash');
const { introspectSchema, wrapSchema } = require('@graphql-tools/wrap');
const { mergeSchemas } = require('@graphql-tools/merge');
const { ApolloServer } = require('apollo-server-cloudflare')
const { graphqlCloudflare } = require('apollo-server-cloudflare/dist/cloudflareApollo');
const { makeExecutableSchema } = require('@graphql-tools/schema');

const executor = async ({ document, variables, context }) => {
  const query = print(document);
  const fetchResult = await fetch('https://graphql.eng-demo.bloomreach.io/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'connector': 'brsm',
      // 'authorization': context.authorization,
    },
    body: JSON.stringify({ query, variables }),
  });

  return fetchResult.json();
};

const createServer = async (request) => {
  const remoteSchema = wrapSchema({
    schema: await introspectSchema(executor),
    executor,
  });
  const { authorization, connector } = Object.fromEntries(request.headers);

  // example data
  const authors = [
    { id: 1, firstName: 'Tom', lastName: 'Coleman' },
    { id: 2, firstName: 'Sashko', lastName: 'Stubailo' },
    { id: 3, firstName: 'Mikhail', lastName: 'Novikov' },
  ];

  const posts = [
    { id: 1, authorId: 1, title: 'Introduction to GraphQL', votes: 2 },
    { id: 2, authorId: 2, title: 'Welcome to Meteor', votes: 3 },
    { id: 3, authorId: 2, title: 'Advanced GraphQL', votes: 1 },
    { id: 4, authorId: 3, title: 'Launchpad is Cool', votes: 7 },
  ];

  const typeDefs = `
    type Author {
      id: Int!
      firstName: String
      lastName: String
      """
      the list of Posts by this author
      """
      posts: [Post]
    }

    type Post {
      id: Int!
      title: String
      author: Author
      votes: Int
    }

    # the schema allows the following query:
    type Query {
      posts: [Post]
      author(id: Int!): Author
    }
  `;
    
  const resolvers = {
    Query: {
      posts: () => posts,
      author: (_, { id }) => find(authors, { id }),
    },

    Author: {
      posts: author => filter(posts, { authorId: author.id }),
    },

    Post: {
      author: post => find(authors, { id: post.authorId }),
    },
  };

  const postsSchema = makeExecutableSchema({ typeDefs, resolvers });

  const mergedSchema = mergeSchemas({
    schemas: [remoteSchema, postsSchema]
  });

  return new ApolloServer({ schema: mergedSchema, context: { authorization, connector } });
}

const handler = async (request) => {
  const server =  await createServer(request);

  return graphqlCloudflare(() => server.createGraphQLServerOptions(request))(request)
}

module.exports = handler