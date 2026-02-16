import { TopNavigation } from "./top-navigation";
import { Id } from "../../../../convex/_generated/dataModel";
import { useEditor } from "../hooks/use-editor";
import { FileBreadcrumbs } from "./file-breadcrumbs";

export const EditorView = ({projectId} : {projectId: Id<"projects">}) => {

  const { activeTabId } = useEditor(projectId);
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center">
        <TopNavigation projectId={projectId} />
      </div>
      {activeTabId && <FileBreadcrumbs projectId = {projectId} />}
    </div>
  );
};