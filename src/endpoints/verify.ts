import { Bool, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";

export class Verify extends OpenAPIRoute {
  schema = {
    tags: ["Verification"],
    summary: "Check if the verification code is valid",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              verification_code: z.string(),
            }),
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Returns the verification result",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
            }),
          },
        },
      },
    },
  };

  async handle(context: Context) {
    const data = await this.getValidatedData<typeof this.schema>();
    const formIds = context.env.PAYMENT_FORM_IDENTIFIERS.split(",").map((id: string) => id.trim());
    const jotformApiKey = context.env.JOTFORM_API_KEY;
    const jotformApiUrl = context.env.JOTFORM_API_URL;
    const verificationCode = data.body.verification_code.trim();

    console.info(`Attempting fast verification for code: ${verificationCode}`);

    const transformForCompare = (v: string) => {
      return v.toUpperCase().replace(/\W/g, "");
    };

    const targetCode = transformForCompare(verificationCode);

    // Helper to query an individual form asynchronously
    const checkForm = async (formId: string): Promise<boolean> => {
      try {
        const response = await fetch(
          `${jotformApiUrl}/form/${formId}/submissions?apiKey=${jotformApiKey}&limit=100&orderby=created_at`
        );

        if (!response.ok) return false;

        const resData: any = await response.json();
        const submissions = resData.content || [];

        for (const entity of submissions) {
          const { answers } = entity;
          if (!answers) continue;

          // 1. Primary Check: Look for field named "uniqueId"
          const orderNumberAnswer: any = Object.values(answers).find(
            (a: any) => a?.name === "uniqueId"
          );

          if (orderNumberAnswer?.answer) {
            if (transformForCompare(String(orderNumberAnswer.answer)) === targetCode) {
              return true;
            }
          }

          // 2. Fallback Check: Search all field values in submission
          const allAnswerValues = Object.values(answers)
            .map((a: any) => a?.answer)
            .filter(Boolean);

          for (const ans of allAnswerValues) {
            if (typeof ans === "string" || typeof ans === "number") {
              if (transformForCompare(String(ans)) === targetCode) {
                return true;
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error querying form ${formId}:`, error);
      }
      return false;
    };

    // Query ALL Jotform forms concurrently in parallel
    const results = await Promise.all(formIds.map((id: string) => checkForm(id)));
    const success = results.some((found: boolean) => found === true);

    console.info(`Verification result for ${verificationCode}: ${success}`);
    return { success };
  }
}