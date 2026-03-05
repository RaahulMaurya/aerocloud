"use client"

import { X, Copy, LinkIcon, Clock, AlertTriangle, QrCode } from "lucide-react"
import { useState } from "react"
import { type FileMetadata, createSharedLink } from "@/lib/storage"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { QRCodeModal } from "./qr-code-modal"

export function ShareLinkModal({
  file,
  onClose,
  onSuccess,
}: {
  file: FileMetadata & { isFolder?: boolean }
  onClose: () => void
  onSuccess?: () => void
}) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [showQRCode, setShowQRCode] = useState(false)

  const handleCreateLink = async () => {
    if (!user) return
    setLoading(true)
    try {
      if (file.isFolder) {
        // For folders, create a download link that will zip the folder
        const fullLink = `${window.location.origin}/download-folder/${user.uid}/${file.name}`
        setShareLink(fullLink)
      } else {
        const link = await createSharedLink(user.uid, file.id, file.name, file.url, file.size, undefined, file.fullPath)
        const fullLink = `${window.location.origin}/shared?id=${link.id}`
        setShareLink(fullLink)
      }
    } catch (error) {
      console.error("[v0] Error creating share link:", error)
      toast({
        title: "Error",
        description: "Failed to create share link. Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCopyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink)
      toast({
        title: "Link copied",
        description: "Share link copied to clipboard.",
      })
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-background/95 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <LinkIcon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">{file.isFolder ? "Share Folder" : "Share File"}</h2>
                <p className="text-xs text-foreground/60">{file.name}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-muted transition"
            >
              <X size={20} className="text-foreground/60" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {!shareLink ? (
              <>
                {/* Warning */}
                <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {file.isFolder ? "Folder will be zipped for download" : "Link expires in 5 hours"}
                    </p>
                    <p className="text-xs text-foreground/60 mt-1">
                      {file.isFolder
                        ? "The folder contents will be compressed into a ZIP file for easy sharing and downloading."
                        : "The share link will automatically expire after 5 hours for security purposes."}
                    </p>
                  </div>
                </div>

                {/* File/Folder Info */}
                {!file.isFolder && (
                  <div className="p-4 bg-muted/40 rounded-lg">
                    <p className="text-sm text-foreground/70">File Size</p>
                    <p className="text-lg font-bold text-foreground mt-1">{file.sizeGB?.toFixed(2) || 0} GB</p>
                  </div>
                )}

                {/* Create Button */}
                <button
                  onClick={handleCreateLink}
                  disabled={loading}
                  className="w-full px-6 py-3 bg-gradient-to-r from-primary to-accent text-primary-foreground rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50"
                >
                  {loading ? "Creating Link..." : `Create Share Link`}
                </button>
              </>
            ) : (
              <>
                {/* Success Message */}
                <div className="flex items-start gap-3 p-4 bg-primary/10 border border-primary/20 rounded-lg">
                  <LinkIcon className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Link created successfully!</p>
                    <p className="text-xs text-foreground/60 mt-1">Share this link with anyone you want.</p>
                  </div>
                </div>

                {/* Expiry Time - only show for files */}
                {!file.isFolder && (
                  <div className="flex items-center gap-2 text-sm text-foreground/70">
                    <Clock size={16} />
                    <span>Expires in 5 hours</span>
                  </div>
                )}

                {/* Share Link */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shareLink}
                    readOnly
                    className="flex-1 px-4 py-2 bg-muted border border-border rounded-lg text-foreground text-sm"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition flex items-center gap-2"
                  >
                    <Copy size={16} />
                    Copy
                  </button>
                </div>

                {/* QR Code Button */}
                <button
                  onClick={() => setShowQRCode(true)}
                  className="w-full px-6 py-3 bg-gradient-to-r from-primary to-accent text-primary-foreground rounded-lg font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
                >
                  <QrCode size={20} />
                  View QR Code
                </button>

                {/* Done Button */}
                <button
                  onClick={() => {
                    if (onSuccess) onSuccess()
                    onClose()
                  }}
                  className="w-full px-6 py-3 bg-muted hover:bg-muted/80 text-foreground rounded-lg font-semibold transition"
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {shareLink && (
        <QRCodeModal
          isOpen={showQRCode}
          onClose={() => setShowQRCode(false)}
          shareLink={shareLink}
          fileName={file.name}
        />
      )}
    </>
  )
}
