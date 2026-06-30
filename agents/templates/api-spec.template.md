Output a single valid JSON object wrapped in a ```json code block. No prose before or after the block.

Schema:

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "[Initiative name] API",
    "version": "1.0.0",
    "description": "One sentence describing what this API delivers for the initiative."
  },
  "servers": [
    { "url": "/api/v1", "description": "Match base path from existing swagger if provided; otherwise use /api/v1" }
  ],
  "tags": [
    { "name": "TagName", "description": "Group of related endpoints — one tag per feature area" }
  ],
  "paths": {
    "/resource": {
      "get": {
        "operationId": "listResources",
        "summary": "List resources",
        "description": "Satisfies FR-XX: [paste the exact FR text here]",
        "tags": ["TagName"],
        "security": [{ "bearerAuth": [] }],
        "parameters": [
          { "name": "cursor", "in": "query", "schema": { "type": "string" }, "description": "Pagination cursor" },
          { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 20, "maximum": 100 } }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": ["data", "next_cursor"],
                  "properties": {
                    "data": { "type": "array", "items": { "$ref": "#/components/schemas/ResourceName" } },
                    "next_cursor": { "type": "string", "nullable": true }
                  }
                }
              }
            }
          },
          "401": { "$ref": "#/components/responses/Unauthorized" }
        }
      },
      "post": {
        "operationId": "createResource",
        "summary": "Create a resource",
        "description": "Satisfies FR-XX: [paste the exact FR text here]",
        "tags": ["TagName"],
        "security": [{ "bearerAuth": [] }],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/CreateResourceRequest" }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ResourceName" }
              }
            }
          },
          "400": { "$ref": "#/components/responses/ValidationError" },
          "401": { "$ref": "#/components/responses/Unauthorized" }
        }
      }
    },
    "/resource/{id}": {
      "get": {
        "operationId": "getResource",
        "summary": "Get a resource by ID",
        "description": "Satisfies FR-XX: [paste the exact FR text here]",
        "tags": ["TagName"],
        "security": [{ "bearerAuth": [] }],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ResourceName" }
              }
            }
          },
          "401": { "$ref": "#/components/responses/Unauthorized" },
          "404": { "$ref": "#/components/responses/NotFound" }
        }
      },
      "patch": {
        "operationId": "updateResource",
        "summary": "Update a resource",
        "description": "Satisfies FR-XX: [paste the exact FR text here]",
        "tags": ["TagName"],
        "security": [{ "bearerAuth": [] }],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/UpdateResourceRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ResourceName" }
              }
            }
          },
          "400": { "$ref": "#/components/responses/ValidationError" },
          "401": { "$ref": "#/components/responses/Unauthorized" },
          "404": { "$ref": "#/components/responses/NotFound" }
        }
      },
      "delete": {
        "operationId": "deleteResource",
        "summary": "Delete a resource",
        "description": "Satisfies FR-XX: [paste the exact FR text here]",
        "tags": ["TagName"],
        "security": [{ "bearerAuth": [] }],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "204": { "description": "Deleted" },
          "401": { "$ref": "#/components/responses/Unauthorized" },
          "404": { "$ref": "#/components/responses/NotFound" }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "ResourceName": {
        "type": "object",
        "description": "Matches the [EntityName] entity from the architecture data model",
        "required": ["id"],
        "properties": {
          "id": { "type": "string", "format": "uuid" },
          "field1": { "type": "string", "description": "Only include fields visible in the Figma screens for this resource" },
          "created_at": { "type": "string", "format": "date-time" },
          "updated_at": { "type": "string", "format": "date-time" }
        }
      },
      "CreateResourceRequest": {
        "type": "object",
        "required": ["field1"],
        "properties": {
          "field1": { "type": "string" }
        }
      },
      "UpdateResourceRequest": {
        "type": "object",
        "properties": {
          "field1": { "type": "string" }
        }
      }
    },
    "responses": {
      "ValidationError": {
        "description": "Request validation failed",
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "required": ["error", "message"],
              "properties": {
                "error": { "type": "string", "example": "VALIDATION_ERROR" },
                "message": { "type": "string" },
                "details": { "type": "array", "items": { "type": "object", "properties": { "field": { "type": "string" }, "message": { "type": "string" } } } }
              }
            }
          }
        }
      },
      "Unauthorized": {
        "description": "Authentication required or token invalid",
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "required": ["error", "message"],
              "properties": {
                "error": { "type": "string", "example": "UNAUTHORIZED" },
                "message": { "type": "string" }
              }
            }
          }
        }
      },
      "NotFound": {
        "description": "Resource not found",
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "required": ["error", "message"],
              "properties": {
                "error": { "type": "string", "example": "NOT_FOUND" },
                "message": { "type": "string" }
              }
            }
          }
        }
      }
    },
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Derive auth scheme from existing swagger if provided; replace this scheme entirely if the existing API uses a different pattern (e.g. API key, OAuth2)"
      }
    }
  }
}
```

Rules:
- Replace all placeholder paths, schema names, and FR references with real values derived from the PRD, architecture brief, and Figma screens.
- Only include paths that satisfy a named PRD functional requirement — cite the FR-ID in every endpoint's description field.
- Schema names must match architecture data model entity names exactly.
- If existing swagger docs are provided, derive the auth scheme, error response format, server base path, and pagination convention from them — replace the template defaults with the real patterns.
- Response schema properties must reflect only the fields visible in the Figma screens for that flow — remove any template placeholder fields that don't appear in the screens.
- Do not include the template's example paths (/resource, /resource/{id}) literally — replace them with real resource paths for this initiative.
- JSON validity: all string values must be valid JSON strings with no literal newlines.
