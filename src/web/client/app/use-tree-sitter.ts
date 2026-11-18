import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TreeSitterStatus } from "../../../shared/tree-sitter.ts";
import { request } from "./api.ts";

const queryKey = ["tree-sitter"] as const;
const toastId = "review-parsers";

export function useTreeSitterSetup(enabled: boolean) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: () => request<TreeSitterStatus>("/api/tree-sitter"),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.installation.state === "running" ? 1000 : false,
  });
  const action = useMutation({
    mutationFn: (action: "install" | "install-detected" | "refresh") =>
      request<TreeSitterStatus>("/api/tree-sitter", "POST", { action }),
    onSuccess: async (status) => {
      // A status read started before the command can still be in flight.
      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, status);
    },
  });

  const status = query.data;
  const { mutate, reset } = action;
  const installation = status?.installation;
  const busy = action.isPending || installation?.state === "running";
  const missing =
    !busy && status?.enabled && status.cli && !status.error
      ? status.review.languages
          .filter((language) => !language.configured)
          .map((language) => language.label)
          .join(", ")
      : "";
  const tools = status?.review.missingTools.join(", ");
  const fromNotification = action.variables === "install-detected";
  const progress =
    fromNotification && busy
      ? installation?.state === "running"
        ? installation.detail
        : "Starting installation…"
      : "";
  const failure =
    fromNotification &&
    !busy &&
    (action.error?.message ||
      (installation?.state === "failed" && installation.detail));
  const complete =
    fromNotification &&
    !busy &&
    !failure &&
    installation?.state === "complete" &&
    installation.detail;

  useEffect(
    () => () => {
      toast.dismiss(toastId);
    },
    [],
  );
  useEffect(() => {
    const options = {
      id: toastId,
      duration: Infinity,
      action: undefined,
      description: undefined,
    };
    if (progress) {
      toast.loading(progress, options);
    } else if (missing || failure) {
      const notify = failure ? toast.error : toast.message;
      notify(
        failure ? "Parser installation failed" : "Missing Tree-sitter parsers",
        {
          ...options,
          description:
            failure ||
            (tools
              ? `${missing}. Setup requires ${tools}. Install the tools, then choose Check again in Settings.`
              : missing),
          descriptionClassName:
            "!text-muted-foreground max-h-32 overflow-y-auto",
          action:
            missing && !tools
              ? {
                  label: failure ? "Retry" : "Install",
                  onClick: (event) => {
                    event.preventDefault();
                    mutate("install-detected");
                  },
                }
              : undefined,
        },
      );
    } else {
      toast.dismiss(toastId);
    }
  }, [missing, tools, progress, failure, mutate]);
  useEffect(() => {
    if (complete) {
      toast.success(complete);
      reset();
    }
  }, [complete, reset]);

  return { query, action };
}

export type TreeSitterSetup = ReturnType<typeof useTreeSitterSetup>;
