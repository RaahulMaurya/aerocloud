"use client"

import type React from "react"

import { useState, useRef } from "react"
import { Upload, X, CheckCircle2, Pause, Play } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { uploadFile } from "@/lib/storage"
import { useToast } from "@/hooks/use-toast"
import { formatETA, calculateETASeconds } from "@/lib/eta-utils"
import { checkFileDuplicate } from "@/lib/duplicate-check"
import { DuplicateHandlingDialog } from "@/components/duplicate-handling-dialog"
import { handleError, logError } from "@/lib/error-handler"

interface UploadingFile {
  id: string
  name: string
  progress: number
  eta: string
  startTime: number
  status: "uploading" | "paused" | "completed" | "failed"
  error?: string
  abortController?: AbortController
}

export function FileUpload({ onUploadComplete, folder = "" }: { onUploadComplete?: () => void; folder?: string }) {
  const { userData, refreshUserData, updateFilesCount } = useAuth()
  const { toast } = useToast()
  const [isDragging, setIsDragging] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false)
  const [duplicateInfo, setDuplicateInfo] = useState<{
    file: File
    existingFile: any
    suggestedName: string
  } | null>(null)
  const uploadAbortControllersRef = useRef<Map<string, AbortController>>(new Map())
  const pausedFilesRef = useRef<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadingFile, setUploadingFile] = useState<UploadingFile | null>(null)

  const handleFileSelect = async (files: File[]) => {
    if (!userData) return

    // Accept all files without size restrictions
    // Backend will handle quota management and validation
    const validFiles = files.filter((file) => {
      // Only basic validation - file must have a name
      if (!file.name || file.name.trim() === "") {
        toast({
          title: "Invalid file",
          description: "File must have a valid name",
          variant: "destructive",
        })
        return false
      }
      return true
    })

    if (validFiles.length === 0) {
      return
    }

    setSelectedFiles([...selectedFiles, ...validFiles])
  }

  const handleDuplicateAction = {
    rename: (newName: string) => {
      if (duplicateInfo?.file) {
        setSelectedFiles([
          ...selectedFiles,
          new File([duplicateInfo.file], newName, {
            type: duplicateInfo.file.type,
          }),
        ])
      }
      setShowDuplicateDialog(false)
      setDuplicateInfo(null)
    },
    replace: () => {
      if (duplicateInfo?.file) {
        setSelectedFiles([...selectedFiles, duplicateInfo.file])
      }
      setShowDuplicateDialog(false)
      setDuplicateInfo(null)
    },
    skip: () => {
      setShowDuplicateDialog(false)
      setDuplicateInfo(null)
      toast({
        title: "File skipped",
        description: "Upload cancelled for this file.",
      })
    },
  }

  const generateFileId = (file: File): string => `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  const handleCancelUpload = (fileId: string) => {
    const controller = uploadAbortControllersRef.current.get(fileId)
    if (controller) {
      controller.abort()
      uploadAbortControllersRef.current.delete(fileId)
    }
    pausedFilesRef.current.delete(fileId)

    setUploadingFiles((prev) =>
      prev.map((file) =>
        file.id === fileId ? { ...file, status: "failed", error: "Upload cancelled by user" } : file,
      ),
    )

    toast({
      title: "Upload cancelled",
      description: "File upload has been stopped and will not resume.",
    })
  }

  const handlePauseUpload = (fileId: string) => {
    pausedFilesRef.current.add(fileId)
    setUploadingFiles((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, status: "paused" } : file)),
    )

    toast({
      title: "Upload paused",
      description: "Click resume to continue the upload.",
    })
  }

  const handleResumeUpload = (fileId: string) => {
    pausedFilesRef.current.delete(fileId)
    setUploadingFiles((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, status: "uploading" } : file)),
    )
  }

  const handleUpload = async () => {
    if (!selectedFiles.length || !userData) return

    const newUploadingFiles: UploadingFile[] = selectedFiles.map((file) => {
      const abortController = new AbortController()
      const fileId = generateFileId(file)
      uploadAbortControllersRef.current.set(fileId, abortController)
      return {
        id: fileId,
        name: file.name,
        progress: 0,
        eta: "calculating...",
        startTime: Date.now(),
        status: "uploading" as const,
        abortController,
      }
    })
    // Calculate total size of new files
    const totalNewSize = selectedFiles.reduce((acc, file) => acc + file.size, 0)
    const maxStorage = userData.maxStorage || 5 * 1024 * 1024 * 1024 // Default 5GB if undefined

    if (userData.storageUsed + totalNewSize > maxStorage) {
      toast({
        title: "Storage quota exceeded",
        description: "Not enough space to upload these files. Please upgrade your plan.",
        variant: "destructive",
      })
      setUploadingFiles((prev) => prev.filter(f => !newUploadingFiles.find(nf => nf.id === f.id)))
      return
    }

    setUploadingFiles((prevFiles) => [...prevFiles, ...newUploadingFiles])

    const uploadPromises = selectedFiles.map(async (file, i) => {
      const folderPath = folder && folder.trim() !== "" ? folder : "root"
      const currentUploadingFile = newUploadingFiles[i]

      try {
        // Wait until upload is not paused - check pausedFilesRef directly
        while (pausedFilesRef.current.has(currentUploadingFile.id)) {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }

        const abortController = uploadAbortControllersRef.current.get(currentUploadingFile.id)
        if (!abortController) return

        // Pass pausedFilesRef to uploadFile so it can also check pause status during progress
        await uploadFile(
          userData.uid,
          file,
          folderPath,
          (progress) => {
            const elapsedMs = Date.now() - currentUploadingFile.startTime
            const eta = calculateETASeconds(progress, elapsedMs)
            const etaString = formatETA(eta)

            // Check pausedFilesRef directly (sync) — don't overwrite 'paused' back to 'uploading'
            const isCurrentlyPaused = pausedFilesRef.current.has(currentUploadingFile.id)

            setUploadingFiles((prevFiles) =>
              prevFiles.map((f) => {
                if (f.id !== currentUploadingFile.id) return f
                if (isCurrentlyPaused || f.status === "paused") {
                  return { ...f, progress: Math.round(progress), eta: etaString }
                }
                return { ...f, status: "uploading", progress: Math.round(progress), eta: etaString }
              }),
            )
          },
          undefined,
          abortController.signal,
          pausedFilesRef.current,
          currentUploadingFile.id,
          userData.storageUsed,
          maxStorage
        )

        // Refresh user data to get updated storage usage from Firestore
        await refreshUserData()

        // Update files count
        if (userData?.filesCount !== undefined) {
          await updateFilesCount(userData.filesCount + 1)
        }


        console.log("Upload complete:", file.name)

        toast({
          title: "File uploaded successfully!",
          description: `${file.name} has been uploaded.`,
        })

        setUploadingFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.id === currentUploadingFile.id
              ? { ...f, status: "completed" as const, progress: 100 }
              : f,
          ),
        )
      } catch (error) {
        if ((error as Error).message === "Upload cancelled by user") {
          console.log("Upload cancelled:", file.name)
        } else {
          const appError = handleError(error)
          logError(appError)

          toast({
            title: "Upload failed",
            description: appError.userMessage,
            variant: "destructive",
          })

          setUploadingFiles((prevFiles) =>
            prevFiles.map((f) =>
              f.id === currentUploadingFile.id
                ? {
                  ...f,
                  status: "failed" as const,
                  error: (error as Error).message,
                }
                : f,
            ),
          )
        }
      } finally {
        uploadAbortControllersRef.current.delete(currentUploadingFile.id)
        pausedFilesRef.current.delete(currentUploadingFile.id)
      }
    })

    await Promise.all(uploadPromises)

    setSelectedFiles([])
    setTimeout(() => {
      onUploadComplete?.()
    }, 500)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    handleFileSelect(files)
  }

  const storageUsedGB = userData?.storageUsed ? userData.storageUsed / (1024 * 1024 * 1024) : 0
  const storageTotalGB =
    userData?.storageTotal || (userData?.maxStorage ? userData.maxStorage / (1024 * 1024 * 1024) : 5)
  const availableGB = Math.max(0, storageTotalGB - storageUsedGB)

  return (
    <div className="space-y-4">
      {/* Drag & Drop Area */}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${isDragging ? "border-accent bg-accent/5 scale-105" : "border-border hover:border-accent hover:bg-accent/5"
          }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => handleFileSelect(Array.from(e.target.files || []))}
          className="hidden"
        />
        <Upload className="w-12 h-12 mx-auto mb-4 text-foreground/40" />
        <p className="text-lg font-semibold text-foreground mb-2">Drop files here or click to browse</p>
        <p className="text-sm text-foreground/60">Available storage: {availableGB.toFixed(2)} GB</p>
      </div>

      {/* Selected Files */}
      {selectedFiles.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Upload className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-foreground">{selectedFiles.length} files selected</p>
                <p className="text-sm text-foreground/60">{selectedFiles.reduce((total, file) => total + file.size / (1024 * 1024), 0).toFixed(2)} MB</p>
              </div>
            </div>
            {!uploading && (
              <button onClick={() => setSelectedFiles([])} className="text-foreground/60 hover:text-foreground">
                <X size={20} />
              </button>
            )}
          </div>

          {/* Progress Bar */}
          {uploadingFiles.length > 0 && (
            <div className="mb-4 space-y-4">
              {uploadingFiles.map((file) => (
                <div key={file.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm text-foreground/70 font-medium truncate">{file.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-lg font-bold text-primary">{file.progress}%</span>
                        <span className="text-sm text-foreground/60">Completes in: {file.eta}</span>
                        {file.status === "completed" && (
                          <span className="text-xs font-semibold text-green-600">Completed</span>
                        )}
                        {file.status === "failed" && (
                          <span className="text-xs font-semibold text-destructive">Failed</span>
                        )}
                        {file.status === "paused" && (
                          <span className="text-xs font-semibold text-yellow-600">Paused</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {file.status === "uploading" && (
                        <>
                          <button
                            onClick={() => handlePauseUpload(file.id)}
                            className="p-2 hover:bg-yellow-600/20 rounded-lg transition hover:scale-110 border border-yellow-600/30 hover:border-yellow-600/60"
                            title="Pause upload"
                          >
                            <Pause size={18} className="text-yellow-600" />
                          </button>
                          <button
                            onClick={() => handleCancelUpload(file.id)}
                            className="p-2 hover:bg-destructive/20 rounded-lg transition hover:scale-110 border border-destructive/30 hover:border-destructive/60"
                            title="Cancel upload"
                          >
                            <X size={18} className="text-destructive" />
                          </button>
                        </>
                      )}
                      {file.status === "paused" && (
                        <>
                          <button
                            onClick={() => handleResumeUpload(file.id)}
                            className="p-2 hover:bg-primary/20 rounded-lg transition hover:scale-110 border border-primary/30 hover:border-primary/60"
                            title="Resume upload"
                          >
                            <Play size={18} className="text-primary" />
                          </button>
                          <button
                            onClick={() => handleCancelUpload(file.id)}
                            className="p-2 hover:bg-destructive/20 rounded-lg transition hover:scale-110 border border-destructive/30 hover:border-destructive/60"
                            title="Cancel upload"
                          >
                            <X size={18} className="text-destructive" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden shadow-sm">
                    <div
                      className="bg-gradient-to-r from-primary to-accent h-full transition-all duration-300"
                      style={{ width: `${file.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Upload Button */}
          {selectedFiles.length > 0 && uploadingFiles.length === 0 && (
            <button
              onClick={handleUpload}
              className="w-full py-2 bg-gradient-to-r from-primary to-accent text-primary-foreground rounded-lg font-semibold hover:shadow-lg transition"
            >
              Upload {selectedFiles.length} File{selectedFiles.length > 1 ? 's' : ''}
            </button>
          )}

          {uploadingFiles.length > 0 && uploadingFiles.every((file) => file.status === "completed") && (
            <div className="flex items-center justify-center gap-2 text-green-600 py-2">
              <CheckCircle2 size={20} />
              <span className="font-semibold">All uploads completed!</span>
            </div>
          )}
        </div>
      )}

      {/* Duplicate Handling Dialog */}
      {showDuplicateDialog && duplicateInfo && (
        <DuplicateHandlingDialog
          existingFile={duplicateInfo.existingFile}
          fileName={duplicateInfo.file.name}
          newFileSize={duplicateInfo.file.size}
          suggestedName={duplicateInfo.suggestedName}
          onRename={handleDuplicateAction.rename}
          onReplace={handleDuplicateAction.replace}
          onSkip={handleDuplicateAction.skip}
        />
      )}
    </div>
  )
}
