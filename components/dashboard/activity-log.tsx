"use client"

import { useState, useEffect } from "react"
import { Download, Upload, Trash2, Share2, Clock, X, CheckSquare, Square } from "lucide-react"
import { getUserActivityLogs, type ActivityLog as ActivityLogType } from "@/lib/storage"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { doc, deleteDoc, writeBatch } from "firebase/firestore"
import { db } from "@/lib/firebase"

const iconMap: Record<string, any> = {
  upload: Upload,
  download: Download,
  delete: Trash2,
  share: Share2,
}

const formatDateTime = (timestamp: Date): string => {
  const d = new Date(timestamp)
  const day = String(d.getDate()).padStart(2, "0")
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const month = monthNames[d.getMonth()]
  const year = d.getFullYear()
  const hours = d.getHours()
  const minutes = String(d.getMinutes()).padStart(2, "0")
  const ampm = hours >= 12 ? "PM" : "AM"
  const displayHour = hours % 12 === 0 ? 12 : hours % 12
  return `${day} ${month} ${year} • ${String(displayHour).padStart(2, "0")}:${minutes} ${ampm}`
}

const formatRelativeTime = (timestamp: Date): string => {
  const now = new Date()
  const diff = now.getTime() - timestamp.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return formatDateTime(timestamp)
}

export function ActivityLog({ full }: { full?: boolean }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [logs, setLogs] = useState<ActivityLogType[]>([])
  const [loading, setLoading] = useState(true)

  // Multi-select state (only for full view)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)

  useEffect(() => {
    const fetchLogs = async () => {
      if (!user) return
      try {
        const activityLogs = await getUserActivityLogs(user.uid, full ? 50 : 5)
        setLogs(activityLogs)
      } catch (error) {
        console.error("Error fetching activity logs:", error)
      } finally {
        setLoading(false)
      }
    }
    fetchLogs()
  }, [user, full])

  const handleDeleteLog = async (logId: string) => {
    if (!user) return
    try {
      await deleteDoc(doc(db, "activityLogs", logId))
      setLogs(logs.filter((log) => log.id !== logId))
      setSelectedIds((prev) => { const s = new Set(prev); s.delete(logId); return s })
      toast({
        title: "Log Deleted",
        description: "Activity log has been removed.",
      })
    } catch (error) {
      console.error("Error deleting log:", error)
      toast({
        title: "Delete Failed",
        description: "Failed to delete activity log.",
        variant: "destructive",
      })
    }
  }

  const handleDeleteSelected = async () => {
    if (!user || selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} activity log(s)?`)) return

    const ids = Array.from(selectedIds)
    let failed = 0

    try {
      // Batch delete in chunks of 500 (Firestore limit)
      const chunks: string[][] = []
      for (let i = 0; i < ids.length; i += 500) {
        chunks.push(ids.slice(i, i + 500))
      }
      for (const chunk of chunks) {
        const batch = writeBatch(db)
        chunk.forEach((id) => batch.delete(doc(db, "activityLogs", id)))
        await batch.commit()
      }
    } catch {
      failed = ids.length
    }

    setLogs((prev) => prev.filter((l) => !selectedIds.has(l.id)))
    setSelectedIds(new Set())
    setSelectMode(false)

    toast({
      title: failed === 0 ? "Logs deleted" : "Delete partially failed",
      description: failed === 0 ? `${ids.length} log(s) removed.` : "Some logs could not be deleted.",
      variant: failed > 0 ? "destructive" : "default",
    })
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(logs.map((l) => l.id)))
    }
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="text-center py-8">
          <Clock className="w-12 h-12 text-foreground/20 mx-auto mb-3" />
          <p className="text-foreground/60">No activity yet</p>
        </div>
      </div>
    )
  }

  return (
    <div className={full ? "space-y-4" : ""}>
      <div className="bg-card border border-border rounded-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          {!full && <h2 className="text-lg font-semibold text-foreground">Recent Activity</h2>}
          {full && (
            <div className="flex gap-2">
              {selectMode && selectedIds.size > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-2 px-3 py-1.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-lg transition text-sm"
                >
                  <Trash2 size={14} />
                  Delete {selectedIds.size} selected
                </button>
              )}
              <button
                onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()) }}
                className="flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition text-sm font-medium"
              >
                {selectMode ? "Cancel" : "Select"}
              </button>
              {selectMode && (
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition text-sm font-medium"
                >
                  {selectedIds.size === logs.length ? <CheckSquare size={14} /> : <Square size={14} />}
                  {selectedIds.size === logs.length ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
          )}
        </div>

        <div className={full ? "space-y-4" : "space-y-3"}>
          {logs.map((log) => {
            const IconComponent = iconMap[log.action] || Clock
            return (
              <div
                key={log.id}
                className={`flex items-start gap-4 pb-4 border-b border-border/50 last:border-b-0 last:pb-0 hover:bg-muted/30 p-3 -mx-3 px-3 rounded-lg transition-colors group ${selectMode && selectedIds.has(log.id) ? "bg-primary/5 ring-1 ring-primary/30" : ""
                  }`}
              >
                {/* Checkbox for select mode (full view only) */}
                {full && selectMode && (
                  <button onClick={() => toggleSelect(log.id)} className="mt-1 flex-shrink-0 text-primary">
                    {selectedIds.has(log.id) ? (
                      <CheckSquare size={18} />
                    ) : (
                      <Square size={18} className="text-foreground/40" />
                    )}
                  </button>
                )}

                <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <IconComponent size={18} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground">
                    <span className="font-semibold capitalize">{log.action}</span> {log.fileName}
                  </p>
                  <p className="text-xs text-foreground/50 mt-1">
                    {full ? formatDateTime(log.timestamp) : formatRelativeTime(log.timestamp)}
                  </p>
                </div>
                {!selectMode && (
                  <button
                    onClick={() => handleDeleteLog(log.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-destructive/10 rounded transition text-destructive"
                    title="Delete log"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
