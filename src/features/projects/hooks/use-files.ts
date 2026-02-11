import { useMutation } from "convex/react";
import { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";

export const useCraeteFile = () => {
  return useMutation(api.files.createFile);
};

export const useCraeteFolder = () => {
  return useMutation(api.files.createFolder);
};