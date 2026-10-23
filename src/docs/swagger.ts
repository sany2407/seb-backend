import swaggerJSDoc from "swagger-jsdoc";

const definition = {
  openapi: "3.0.0",
  info: {
    title: "Shared EB Bill API",
    version: "0.1.0",
    description:
      "SaaS backend for shared EB meter billing. Sign up via `POST /api/auth/signup`, then click **Authorize** and paste the `access_token` as a Bearer token.",
  },
  servers: [{ url: "http://localhost:4000", description: "local" }],
  tags: [
    { name: "Auth" },
    { name: "Homes" },
    { name: "Meters" },
    { name: "Readings" },
    { name: "Bills" },
    { name: "Splits" },
    { name: "Payments" },
    { name: "Settings" },
    { name: "Attachments" },
    { name: "Uploads" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    responses: {
      BadRequest: { description: "Validation / domain error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      Unauthorized: { description: "Missing / invalid Bearer token", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      NotFound: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    },
    schemas: {
      Error: { type: "object", properties: { error: { type: "string" } } },
      User: { type: "object", properties: { id: { type: "string", format: "uuid" }, email: { type: "string" } } },
      Profile: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" }, email: { type: "string" },
          display_name: { type: "string" }, created_at: { type: "string", format: "date-time" },
        },
      },
      AuthSession: {
        type: "object",
        properties: {
          user: { $ref: "#/components/schemas/User" },
          session: {
            type: "object",
            properties: {
              access_token: { type: "string" }, refresh_token: { type: "string" },
              expires_in: { type: "number" }, token_type: { type: "string" },
            },
          },
        },
      },
      Home: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" }, name: { type: "string" }, occupant: { type: "string" },
          meter_no: { type: "string" }, meter_type: { type: "string", enum: ["MAIN", "SUB"] },
          active: { type: "boolean" }, notes: { type: "string" },
        },
      },
      Meter: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" }, home_id: { type: "string", format: "uuid", nullable: true },
          meter_no: { type: "string" }, type: { type: "string", enum: ["MAIN", "SUB"] }, active: { type: "boolean" },
          billing_interval_months: { type: "number" }, unit_price: { type: "number" },
        },
      },
      Reading: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" }, month_key: { type: "string", example: "2026-10" },
          prev: { type: "number" }, curr: { type: "number" }, units: { type: "number" }, meter_reset: { type: "boolean" },
        },
      },
      Bill: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" }, month_key: { type: "string" }, month: { type: "string" },
          bill_no: { type: "string" }, main_prev: { type: "number" }, main_curr: { type: "number" },
          main_units: { type: "number" }, amount: { type: "number" },
          status: { type: "string", enum: ["Pending", "Paid", "Partial", "Overdue"] },
          paid: { type: "number" }, method: { type: "string", enum: ["usage", "equal", "percentage"] },
          common_units: { type: "number" }, common_amount: { type: "number" },
        },
      },
      BillSplit: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" }, bill_id: { type: "string", format: "uuid" },
          home_id: { type: "string", format: "uuid", nullable: true },
          home_name: { type: "string" }, units: { type: "number" },
          percent: { type: "number" }, amount: { type: "number" },
        },
      },
      Payment: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" }, bill_id: { type: "string", format: "uuid" },
          amount: { type: "number" }, paid_at: { type: "string", format: "date" },
          method: { type: "string" }, ref: { type: "string" },
        },
      },
      Attachment: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" }, owner_type: { type: "string" }, owner_id: { type: "string" },
          file_name: { type: "string" }, file_url: { type: "string" },
          file_type: { type: "string" }, file_size: { type: "number" }, attachment_type: { type: "string" },
        },
      },
    },
  },
};

export const swaggerSpec = swaggerJSDoc({ definition, apis: ["./src/routes/*.ts", "./dist/routes/*.js"] });
