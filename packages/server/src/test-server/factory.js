// Embeddable demo OPC UA server. The gateway runs one in-process by default;
// the standalone runner (standalone.js) exposes the same model on its own port.
import { OPCUAServer } from 'node-opcua';
import { buildDemoAddressSpace } from './address-space.js';

export const DEFAULT_PORT = 4840;

export async function createTestServer({ port = DEFAULT_PORT, variant = 'V1' } = {}) {
  const server = new OPCUAServer({
    port,
    buildInfo: {
      productName: 'OPC UA Address Browser Demo Server',
      manufacturerName: 'demo',
      productUri: 'urn:demo:test-server',
      buildNumber: variant,
      buildDate: new Date(),
    },
  });
  await server.initialize();
  const model = await buildDemoAddressSpace(server, variant);
  return { server, model, variant };
}

export async function startTestServer(options) {
  const { server, model, variant } = await createTestServer(options);
  await server.start();
  const endpoint = server.endpoints[0]?.endpointDescriptions()[0];
  return {
    server,
    model,
    variant,
    endpointUrl: endpoint?.endpointUrl ?? `opc.tcp://localhost:${options?.port ?? DEFAULT_PORT}`,
    async shutdown() {
      model.dispose();
      await server.shutdown();
    },
  };
}
