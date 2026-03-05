import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";

import { Id } from "../../../../convex/_generated/dataModel";


export const useProject = (projectId: Id<"projects">) => {
  return useQuery(api.projects.getById, {
    id: projectId,
  });
};

export const useProjects = () => {
  return useQuery(api.projects.get);
};

export const useProjectsPartial = (limit: number) => {
  return useQuery(api.projects.getPartial,{
    limit,
  });
};

export const useCreateProject = () => {
  return useMutation(api.projects.create).withOptimisticUpdate(
    (localStore, args) => {
      const existingProjects = localStore.getQuery(api.projects.get);

      if (existingProjects !== undefined) {
        const optimisticTime = (existingProjects[0]?.updatedAt ?? 0) + 1;
        const newProject = {
          _id: crypto.randomUUID() as Id<"projects">,
          _creationTime: optimisticTime,
          name: args.name,
          ownerId: "anonymous",
          updatedAt: optimisticTime,
        };
        localStore.setQuery(api.projects.get, {}, [
          newProject,
          ...existingProjects,
        ]);
      }
    }
  )
};

export const useRenameProject = () => {
  return useMutation(api.projects.rename).withOptimisticUpdate(
    (localStore, args) => {
      const existingProject = localStore.getQuery(api.projects.getById, { id: args.id} );

      if (existingProject !== undefined && existingProject !== null) {
        const optimisticTime = (existingProject.updatedAt ?? 0) + 1;
        localStore.setQuery(
          api.projects.getById,
          { id: args.id },
          {
            ...existingProject,
            name: args.name,
            updatedAt: optimisticTime,
          }
        );
      }

      const existingProjects = localStore.getQuery(api.projects.get);

      if (existingProjects !== undefined){
        localStore.setQuery(
          api.projects.get,
          {},
          existingProjects.map((project) => {
            const optimisticTime = (project.updatedAt ?? 0) + 1;
            return project._id === args.id
              ? { ...project, name: args.name, updatedAt: optimisticTime }
              : project;
          })
        );
      }
    }
  )
};
