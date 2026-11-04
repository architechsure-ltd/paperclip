import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { issuesApi } from "../api/issues";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export interface HumanReviewDecisionSnapshot {
  currentStageId: string;
  lastDecisionId: string | null;
}

export interface HumanReviewEscalationContext {
  reviewerAgentId?: string | null;
  reviewerName?: string | null;
  reason: string;
}

export function readHumanReviewDecisionMetadata(
  metadata: Record<string, unknown> | null | undefined,
): { decision: HumanReviewDecisionSnapshot; escalation: HumanReviewEscalationContext | null } | null {
  const rawDecision = metadata?.reviewDecision;
  if (!rawDecision || typeof rawDecision !== "object") return null;
  const currentStageId = (rawDecision as Record<string, unknown>).currentStageId;
  const lastDecisionId = (rawDecision as Record<string, unknown>).lastDecisionId;
  if (
    typeof currentStageId !== "string" ||
    (lastDecisionId !== null && typeof lastDecisionId !== "string")
  ) return null;

  const rawEscalation = metadata?.reviewEscalation;
  const escalation = rawEscalation && typeof rawEscalation === "object"
    && typeof (rawEscalation as Record<string, unknown>).reason === "string"
    ? {
        reviewerAgentId:
          typeof (rawEscalation as Record<string, unknown>).reviewerAgentId === "string"
            ? String((rawEscalation as Record<string, unknown>).reviewerAgentId)
            : null,
        reason: String((rawEscalation as Record<string, unknown>).reason),
      }
    : null;
  return { decision: { currentStageId, lastDecisionId }, escalation };
}

interface HumanReviewDecisionActionsProps {
  issueId: string;
  companyId: string;
  decision: HumanReviewDecisionSnapshot;
  escalation?: HumanReviewEscalationContext | null;
  footerSlot?: ReactNode;
  onResolved?: (action: "approve" | "request_changes") => void;
  className?: string;
}

export function HumanReviewDecisionActions({
  issueId,
  companyId,
  decision,
  escalation,
  footerSlot,
  onResolved,
  className,
}: HumanReviewDecisionActionsProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [comment, setComment] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (action: "approve" | "request_changes") =>
      issuesApi.update(issueId, {
        status: action === "approve" ? "done" : "in_progress",
        comment: comment.trim(),
        reviewDecision: decision,
      }),
    onSuccess: (_result, action) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.attention(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(issueId) });
      setComment("");
      setErrorMessage(null);
      pushToast({
        title:
          action === "approve"
            ? "Review approved"
            : "Changes requested — task returned to Engineering",
        tone: "success",
      });
      onResolved?.(action);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Please refresh and try again.";
      setErrorMessage(message);
      pushToast({ title: "Could not record the review decision", body: message, tone: "error" });
    },
  });

  const commentEmpty = comment.trim().length === 0;
  const pending = mutation.isPending;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {escalation ? (
        <div className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="font-medium">Review rounds exhausted</p>
          <p className="text-muted-foreground">
            {escalation.reviewerName
              ? `${escalation.reviewerName} escalated this review: `
              : "The reviewer escalated this review: "}
            {escalation.reason}
          </p>
        </div>
      ) : null}
      <Textarea
        value={comment}
        onChange={(event) => {
          setComment(event.target.value);
          setErrorMessage(null);
        }}
        placeholder="Decision comment (required)…"
        aria-label="Decision comment"
        className="min-h-16 text-sm"
        disabled={pending}
      />
      {errorMessage ? <p role="alert" className="text-sm text-destructive">{errorMessage}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        {footerSlot ?? <span className="hidden sm:block" />}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || commentEmpty}
            title={commentEmpty ? "Add a decision comment" : undefined}
            onClick={() => mutation.mutate("request_changes")}
          >
            {pending && mutation.variables === "request_changes" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="size-4" aria-hidden />
            )}
            Request changes
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending || commentEmpty}
            title={commentEmpty ? "Add a decision comment" : undefined}
            onClick={() => mutation.mutate("approve")}
          >
            {pending && mutation.variables === "approve" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4" aria-hidden />
            )}
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}
