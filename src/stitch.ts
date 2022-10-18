
import { stitchSchemas } from '@graphql-tools/stitch';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { printSchema, graphql, buildSchema, print, GraphQLSchema } from 'graphql';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { stitchingDirectives } from '@graphql-tools/stitching-directives';
import { wrapSchema } from '@graphql-tools/wrap';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import chalk from 'chalk';

const { allStitchingDirectivesTypeDefs, stitchingDirectivesTransformer } = stitchingDirectives()


/**
 * Reads "graphql/<name>.graphql".
 */
function readGraphSource(name: string): string {
  const graphqlSourcePath = url.fileURLToPath(new URL('../graphql', import.meta.url));
  return allStitchingDirectivesTypeDefs + fs.readFileSync(path.join(graphqlSourcePath, name + '.graphql'), 'utf-8');
}


/**
 * Build the feeds graph. Just provides Credential and friends.
 */
function buildFeedSchema() {
  const src = readGraphSource('feeds');

  return makeExecutableSchema({
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
          const clientId = 'hi nub 🍌';

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

        getWhatever: () => Math.floor(1024 * Math.random()),
      },

      Credential: {
        name: (parent) => {
          return `Other lazy resolvers still work (_id=${parent._id})`;
        },
      }
    },
  });
}


/**
 * Build the model graph. Just provides Client.
 */
function buildModelSchema() {
  const src = readGraphSource('model');

  return makeExecutableSchema({
    typeDefs: src,
    resolvers: {
      Client: {
        name: () => 'hi',  // this wins over getClient
      },
      Query: {
        getClient: (parent, args, context, info) => {
          console.info('model getClient', { parent, args, context });
          return {
            _id: args.id,
            name: 'A NAME',
            tenantCode: `hello tenant (id=${args.id})`,
          };
        },
      },
    },
  });
}


function buildPretendRemoteSchema(remote: GraphQLSchema) {
  // We serialize this to a string to show what sharing over a network or loading somehow would
  // look like. In practice the GraphQL files would be shared on disk or sth.
  // NOTE: We have to use `printSchemaWithDirectives` otherwise @key/@merge get dropped.
  const src = printSchemaWithDirectives(remote);

  return wrapSchema({
    schema: buildSchema(src, {}),
    executor: async (req) => {
      const query = print(req.document);

      // wait a random amount of time
      const delay = ~~(Math.random() * 2_000);

      console.debug(`Waiting ${chalk.cyanBright(`${(delay / 1000).toFixed(1)}s`)} to run query on 'remote' graph:`);
      console.debug(chalk.magentaBright(query));
      console.debug();

      await new Promise((r) => setTimeout(r, delay));

      const out = await graphql({ schema: remote, source: query, variableValues: req.variables });

      return out as any;
    },
  });
}


export function stitchGraphs() {
  const subschemas = [
    buildPretendRemoteSchema(buildFeedSchema()),
    buildPretendRemoteSchema(buildModelSchema()),
  ];
  const supergraph = stitchSchemas({
    // nb. This is important, it won't merge data without this.
    subschemaConfigTransforms: [stitchingDirectivesTransformer],
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
    clientId
    client {
      # nb. We _don't_ need to fetch this since the merge config enforces it.
      # _id
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
  console.info('got result ==>');
  console.info(chalk.yellowBright(JSON.stringify(eout.data, undefined, 2)));
}


main();
