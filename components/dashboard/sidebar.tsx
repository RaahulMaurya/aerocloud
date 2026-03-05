"use client"

import { useState } from "react"
import { LayoutGrid, FileText, LinkIcon, Activity, Settings, UploadIcon, Star, Crown, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface SidebarProps {
    activeTab: string
    onNavigate: (tab: string) => void
    isFileToURLAllowed?: boolean
    isChatbotAllowed?: boolean
}

export function Sidebar({ activeTab, onNavigate }: SidebarProps) {
    const [isCollapsed, setIsCollapsed] = useState(false)

    const navItems = [
        { id: "overview", label: "Overview", icon: LayoutGrid },
        { id: "upload", label: "Upload Files", icon: UploadIcon },
        { id: "files", label: "My Files", icon: FileText },
        { id: "starred", label: "Starred Files", icon: Star },

        { id: "shared-links", label: "Shared Links", icon: LinkIcon },
        { id: "plans", label: "Plans & Pricing", icon: Crown },
        { id: "activity", label: "Activity Log", icon: Activity },
        { id: "settings", label: "Settings", icon: Settings },
    ]

    return (
        <div
            className={cn(
                "hidden lg:flex flex-col h-full bg-card/50 backdrop-blur-xl border-r border-border transition-all duration-300 ease-in-out relative group/sidebar",
                isCollapsed ? "w-20" : "w-64"
            )}
        >
            {/* Collapse Toggle */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className={cn(
                    "absolute -right-3 top-8 z-50",
                    "h-6 w-6 rounded-full border border-border bg-background shadow-sm flex items-center justify-center",
                    "text-muted-foreground hover:text-foreground hover:shadow-md transition-all duration-200",
                    "opacity-0 group-hover/sidebar:opacity-100 focus:opacity-100",
                    isCollapsed && "opacity-100"
                )}
            >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>

            {/* Navigation */}
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto scrollbar-hide">
                {navItems.map((item) => {
                    const Icon = item.icon
                    const isActive = activeTab === item.id

                    return (
                        <button
                            key={item.id}
                            onClick={() => onNavigate(item.id)}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative",
                                isActive
                                    ? "bg-primary/10 text-primary font-medium"
                                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                                isCollapsed && "justify-center px-2"
                            )}
                            title={isCollapsed ? item.label : undefined}
                        >
                            {isActive && !isCollapsed && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full" />
                            )}
                            <Icon
                                size={20}
                                className={cn(
                                    "flex-shrink-0 transition-transform duration-200",
                                    isActive ? "scale-110" : "group-hover:scale-110"
                                )}
                            />
                            {!isCollapsed && (
                                <span className="font-medium truncate animate-in fade-in slide-in-from-left-2 duration-200">
                                    {item.label}
                                </span>
                            )}

                            {/* Tooltip for collapsed state */}
                            {isCollapsed && (
                                <div className="absolute left-full ml-4 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md shadow-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                                    {item.label}
                                </div>
                            )}
                        </button>
                    )
                })}
            </nav>

            {/* Footer */}
            {!isCollapsed && (
                <div className="p-4 border-t border-border/50">
                    <div className="text-center text-xs text-foreground/40">
                        <p>© 2026 AeroCloud</p>
                    </div>
                </div>
            )}
        </div>
    )
}
