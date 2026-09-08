import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OvsClient } from "./api.js";
import { ConfirmationStore } from "./confirmations.js";
import { cartMutationFailurePayload, safeError } from "./errors.js";
import { type LoginFlow, startLoginServer } from "./login-server.js";
import type { SearchResult } from "./normalize.js";
import { cartQuantity } from "./normalize.js";
import { OvsService } from "./service.js";
import { publicSessionSummary } from "./session.js";

export interface CreateServerOptions {
  sessionPath: string;
  client?: OvsClient;
  confirmationStore?: ConfirmationStore;
}
const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const genericOutput = { data: z.unknown() };

export function createServer(options: CreateServerOptions): McpServer {
  const server = new McpServer(
    {
      name: "ovs-mcp",
      version: "1.2.0",
      websiteUrl: "https://github.com/ncleton/ovs-mcp",
    },
    {
      capabilities: { logging: {} },
      instructions:
        "Call connect_ovs before the first OVS operation. If connection is required, present its secure login URL to the user. Never ask for OVS credentials in chat or in an MCP form. After connection, search_products returns exact product, attribute, and customization IDs. Cart mutations require those exact IDs and a preview call followed by the same tool with its confirmation token.",
    },
  );
  const client =
    options.client ?? new OvsClient({ sessionPath: options.sessionPath });
  const service = new OvsService(client);
  const confirmations = options.confirmationStore ?? new ConfirmationStore();
  let loginFlow: LoginFlow | undefined;

  server.registerTool(
    "connect_ovs",
    {
      title: "Connect Official Vegan Shop",
      description:
        "Check the OVS connection. When needed, returns a private local login URL that the client must present to the user. Credentials never pass through MCP.",
      inputSchema: {},
      outputSchema: genericOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async () =>
      result(async () => {
        if (await client.isAuthenticated()) {
          loginFlow = undefined;
          return {
            data: { status: "connected", session: publicSessionSummary() },
          };
        }
        loginFlow ??= await startLoginServer(client);
        return {
          data: {
            status: "connection_required",
            loginUrl: loginFlow.url,
            userAction:
              "Open this secure local page, sign in to Official Vegan Shop, then call connect_ovs again.",
          },
        };
      }),
  );

  server.registerTool(
    "search_products",
    {
      title: "Search OVS products",
      description: "Search the live Official Vegan Shop catalog.",
      inputSchema: {
        query: z.string().trim().min(2).max(120),
        page: z.number().int().min(1).max(100).default(1),
        limit: z.number().int().min(1).max(50).default(20),
      },
      outputSchema: {
        query: z.string(),
        page: z.number(),
        limit: z.number(),
        total: z.number(),
        products: z.array(
          z.object({
            id: z.string(),
            productAttributeId: z.string(),
            productCustomizationId: z.string().nullable(),
            name: z.string(),
            manufacturer: z.string().nullable(),
            category: z.string().nullable(),
            price: z.union([z.string(), z.number()]).nullable(),
            unitPrice: z.union([z.string(), z.number()]).nullable(),
            quantity: z.union([z.string(), z.number()]).nullable(),
            availableForOrder: z
              .union([z.boolean(), z.string(), z.number()])
              .nullable(),
            reference: z.string().nullable(),
            url: z.string().nullable(),
          }),
        ),
      },
      annotations: readAnnotations,
    },
    async ({ query, page, limit }) =>
      result(() => service.searchProducts(query, page, limit)),
  );

  registerReadTool(
    server,
    "get_cart",
    "Get OVS cart",
    "Read the connected account cart without returning customer or address data.",
    () => service.getCart(),
  );
  registerCartMutation(
    server,
    "add_to_cart",
    "Add OVS product to cart",
    "add",
    service,
    confirmations,
  );
  registerCartMutation(
    server,
    "remove_from_cart",
    "Remove OVS product from cart",
    "remove",
    service,
    confirmations,
  );
  server.server.onclose = () => {
    if (loginFlow) void loginFlow.close().catch(() => undefined);
  };
  return server;
}

function registerCartMutation(
  server: McpServer,
  name: "add_to_cart" | "remove_from_cart",
  title: string,
  operation: "add" | "remove",
  service: OvsService,
  confirmations: ConfirmationStore,
): void {
  server.registerTool(
    name,
    {
      title,
      description:
        operation === "add"
          ? "Preview, confirm, and add one or more units of an exact OVS product variant returned by search_products."
          : "Preview, confirm, and remove one or more units of an exact OVS product variant returned by search_products.",
      inputSchema: {
        productId: z.string().regex(/^[1-9]\d*$/),
        productAttributeId: z.string().regex(/^\d+$/),
        productCustomizationId: z.string().regex(/^\d+$/),
        quantity: z.number().int().min(1).max(50).default(1),
        confirmationToken: z.string().uuid().optional(),
      },
      outputSchema: genericOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      productId,
      productAttributeId,
      productCustomizationId,
      quantity,
      confirmationToken,
    }) =>
      result(async () => {
        if (!confirmationToken) {
          const cart = await service.getCart();
          const currentQuantity = cartQuantity(
            cart,
            productId,
            productAttributeId,
            productCustomizationId,
          );
          if (operation === "remove" && currentQuantity < quantity)
            throw new Error(
              "Cannot remove more units than the cart currently contains.",
            );
          return {
            data: {
              status: "confirmation_required",
              operation,
              productId,
              productAttributeId,
              productCustomizationId,
              quantity,
              currentQuantity,
              resultingQuantity:
                currentQuantity + (operation === "add" ? quantity : -quantity),
              confirmationToken: confirmations.create(
                operation,
                productId,
                productAttributeId,
                productCustomizationId,
                quantity,
                cart,
              ),
              expiresInSeconds: 300,
            },
          };
        }
        const expectedCartFingerprint = confirmations.consume(
          confirmationToken,
          operation,
          productId,
          productAttributeId,
          productCustomizationId,
          quantity,
        );
        const cart =
          operation === "add"
            ? await service.addToCart(
                productId,
                productAttributeId,
                productCustomizationId,
                quantity,
                expectedCartFingerprint,
              )
            : await service.removeFromCart(
                productId,
                productAttributeId,
                productCustomizationId,
                quantity,
                expectedCartFingerprint,
              );
        return {
          data: {
            status: "applied",
            operation,
            productId,
            productAttributeId,
            productCustomizationId,
            quantity,
            cart,
          },
        };
      }),
  );
}

function registerReadTool(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  action: () => Promise<unknown>,
): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: {},
      outputSchema: genericOutput,
      annotations: readAnnotations,
    },
    async () => result(async () => ({ data: await action() })),
  );
}

async function result<T extends Record<string, unknown> | SearchResult>(
  action: () => Promise<T>,
) {
  try {
    const structuredContent = await action();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
      structuredContent,
    };
  } catch (error) {
    const mutationFailure = cartMutationFailurePayload(error);
    if (mutationFailure) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(mutationFailure, null, 2),
          },
        ],
        structuredContent: mutationFailure,
      };
    }
    const safe = safeError(error);
    return {
      isError: true,
      content: [
        { type: "text" as const, text: `${safe.code}: ${safe.message}` },
      ],
    };
  }
}
