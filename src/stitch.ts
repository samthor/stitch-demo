
import { stitchSchemas } from '@graphql-tools/stitch';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { printSchema, graphql } from 'graphql';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';


/**
 * Reads "graphql/<name>.graphql".
 */
function readGraphSource(name: string): string {
  const graphqlSourcePath = url.fileURLToPath(new URL('../graphql', import.meta.url));
  return fs.readFileSync(path.join(graphqlSourcePath, name + '.graphql'), 'utf-8');
}


/**
 * Build the feeds graph. Just provides Credential and friends.
 */
function buildFeedsGraph() {
  const src = readGraphSource('feeds');

  const schema = makeExecutableSchema({
    typeDefs: src,
    resolvers: {
      Query: {
        getCredential: (parent, args, context, info) => {
          // nb. info.fieldNodes is always O(1) and poins to ourselves
          // This still includes things we cannot resolve (if provided by stitching)
          const fieldsRequestedOnCredential = info.fieldNodes[0].selectionSet?.selections;
          console.info('getCredential', args);

          // TODO: pretend we have a credential id'ed "valid-credential-id" and a client "some-client-id"
          const { id } = args;
          if (id !== 'valid-credential-id') {
            return null;
          }
          const clientId = 'some-client-id';

          const out = {
            _id: id,
            clientId,
            // We need to return the stub Client so the stitcher knows to "fill it in".
            client: {
              _id: clientId,
            },
          };

          console.info('...returned', out);

          return out;
        },
      },

      Credential: {
        name: (parent) => {
          return `Other lazy resolvers still work (_id=${parent._id})`;
        },
      }
    },
  });

  return {
    schema,
  };
}


/**
 * Build the model graph. Just provides Client.
 */
function buildModelGraph() {
  const src = readGraphSource('model');

  const schema = makeExecutableSchema({
    typeDefs: src,
    resolvers: {
      Client: {
        name: () => 'hi',
      },
      Query: {
        getClient: (parent, args, context, info) => {
          console.info('model getClient', { parent, args, context });
          return {
            _id: args.id,
            name: 'A NAME',
            tenantCode: 'hello tenant',
          };
        },
      },
    },
  });

  return {
    schema,
    merge: {
      Client: {
        fieldName: 'getClient',

        // This says: for _other_ graphs, we must have `_id` in order to answer this request.
        // Otherwise for sub-models the user has to include it, which doesn't make sense.
        selectionSet: '{ _id }',

        // nb. "other" contains information we have from the other graph(s). Since `selectionSet`
        // has `_id` above, we know we have it here.
        args: (other) => ({ id: other._id }),
      },
    },
  };
}


export function stitchGraphs() {
  const subschemas = [
    // TODO: how do we make these "remote"?
    buildFeedsGraph(),
    buildModelGraph(),
  ];
  const supergraph = stitchSchemas({
    subschemas,
    mergeTypes: true,
    mergeDirectives: true,
  });

  return {
    supergraph,
    source: printSchema(supergraph),
  };
}




async function main() {
  const out = stitchGraphs();
  const query = /* GraphQL */ `
{
  getCredential(id: "valid-credential-id") {
    _id
    client {
      _id
      name
      tenantCode
    }
    name
  }
  getWhatever
}
  `;

  const eout = await graphql({
    schema: out.supergraph,
    source: query,
    rootValue: {},
  });
  console.info();
  if (eout.errors) {
    console.warn('errors', eout.errors);
  }
  console.info('got result ==>', JSON.stringify(eout.data, undefined, 2));
}


main();
