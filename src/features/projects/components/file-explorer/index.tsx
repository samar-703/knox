import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { ChevronRightIcon } from "lucide-react"
import { useState } from "react"

export const FileExplorer = () => {
  const [isOpen, setIsOpen] = useState(false);


  return (
    <div className="h-full bg-sidebar">
      <ScrollArea>
        <div
          role="button"
          onClick={() => setIsOpen((value) => !value)}
          className="group/project cursor-pointer w-full text-left flex items-center gap-0.5 h-5.5 bg-accent font-bold"
        >
          <ChevronRightIcon
            className={cn()}
          
          />
          
        </div>
      </ScrollArea>
    </div>
  )
}