// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HumanReviewDecisionActions } from "./HumanReviewDecisionActions";

const update = vi.hoisted(() => vi.fn());
vi.mock("../api/issues", () => ({ issuesApi: { update } }));
vi.mock("../context/ToastContext", () => ({
  useToastActions: () => ({ pushToast: vi.fn() }),
}));

describe("HumanReviewDecisionActions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    update.mockReset().mockResolvedValue({});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each([
    ["Approve", "done"],
    ["Request changes", "in_progress"],
  ])("requires a comment and sends %s through the guarded issue update", async (label, status) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <HumanReviewDecisionActions
            issueId="issue-1"
            companyId="company-1"
            decision={{
              currentStageId: "11111111-1111-4111-8111-111111111111",
              lastDecisionId: null,
            }}
          />
        </QueryClientProvider>,
      );
    });

    const button = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.includes(label));
    expect(button?.disabled).toBe(true);

    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "Owner decision rationale");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button?.disabled).toBe(false);

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledWith("issue-1", {
      status,
      comment: "Owner decision rationale",
      reviewDecision: {
        currentStageId: "11111111-1111-4111-8111-111111111111",
        lastDecisionId: null,
      },
    });
    client.clear();
  });
});
