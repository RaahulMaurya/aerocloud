"use client"

import {
  Download,
  Share2,
  Trash2,
  FileIcon,
  Search,
  FolderPlus,
  Upload,
  Eye,
  Folder,
  Grid3x3,
  List,
  Star,
  Edit2,
  ImageIcon,
  Video,
  Music,
  FileText,
  CheckSquare,
  Square,
} from "lucide-react"
import { useState, useEffect } from "react"
import { useAuth } from "@/contexts/auth-context"
import {
  listUserFiles,
  deleteFile,
  toggleFileStarred,
  renameFile,
  toggleFolderStarred,
  type FileMetadata,
  getFilePreviewType,
  renameFolder,
  deleteFolder as deleteFolderFromStorage,
  recalculateUserStorage,
} from "@/lib/storage"
import { useToast } from "@/hooks/use-toast"
import { FilePreviewModal } from "./file-preview-modal"
import { ShareLinkModal } from "./share-link-modal"
import { CreateFolderModal } from "./create-folder-modal"
import { FileUpload } from "./file-upload"
import { ref, deleteObject, listAll, getMetadata, getDownloadURL } from "firebase/storage"
import { storage, db } from "@/lib/firebase"
import { collection, query, getDocs, doc as firestoreDoc, getDoc, onSnapshot, orderBy, limit, startAfter } from "firebase/firestore"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { appCache, CACHE_KEYS } from "@/lib/cache-manager"
import { Loader2 } from "lucide-react"

interface FolderItem {
  id: string
  name: string
  displayName: string
  path: string
  parentPath: string
  starred?: boolean
  createdAt?: Date
}

export function FilesList() {
  const userAuth = useAuth()
  const { user, userData, updateStorageUsed } = userAuth
  const { toast } = useToast()
  const [files, setFiles] = useState<FileMetadata[]>([])
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [currentFolder, setCurrentFolder] = useState<string>("root")

  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [selectedFolders, setSelectedFolders] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [previewFile, setPreviewFile] = useState<FileMetadata | null>(null)
  const [shareFile, setShareFile] = useState<FileMetadata | null>(null)
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [uploadToFolder, setUploadToFolder] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [renamingFile, setRenamingFile] = useState<string | null>(null)
  const [newFileName, setNewFileName] = useState("")
  const [fileStarred, setFileStarred] = useState<Record<string, boolean>>({})
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState("")
  const [shareFolder, setShareFolder] = useState<FolderItem | null>(null)

  // Deletion state
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState("")

  const [lastDoc, setLastDoc] = useState<any>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Real-time listener for current folder
  useEffect(() => {
    if (!user) return

    setLoading(true)

    // 1. Listen to files
    const filesQuery = query(
      collection(db, `files/${user.uid}/userFiles`),
      orderBy("createdAt", "desc"),
      limit(50)
    )

    const unsubscribeFiles = onSnapshot(filesQuery, async (snapshot) => {
      // Process files
      const updatedFilesPromises = snapshot.docs.map(async (docSnapshot) => {
        const data = docSnapshot.data()
        let url = data.url
        if (!url && data.storagePath) {
          try {
            url = await getDownloadURL(ref(storage, data.storagePath))
          } catch (e) { }
        }
        return {
          id: docSnapshot.id,
          name: data.displayName || data.name,
          size: Math.round(Number(data.size)),
          type: data.contentType,
          url: url || "",
          fullPath: data.storagePath,
          folder: data.folder || (data.parentPath?.split("/").pop()) || "root",
          uploadedAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          starred: data.starred || false
        } as FileMetadata
      })

      const resolvedFiles = await Promise.all(updatedFilesPromises)

      // Get starred status overrides
      const starredStatus: Record<string, boolean> = {}
      for (const file of resolvedFiles) {
        if (file.starred) starredStatus[file.id] = true
      }
      setFileStarred(prev => ({ ...prev, ...starredStatus }))

      // Filter by folder in memory for reactive updates
      setFiles(resolvedFiles.filter(f => currentFolder === "root" ? true : f.folder === currentFolder))

      if (snapshot.docs.length > 0) {
        setLastDoc(snapshot.docs[snapshot.docs.length - 1])
        setHasMore(snapshot.docs.length === 50)
      } else {
        setHasMore(false)
      }

      setLoading(false)
    })

    // 2. Listen to Folders
    let unsubscribeFolders = () => { }
    if (currentFolder === "root") {
      const foldersQuery = query(collection(db, `folders/${user.uid}/userFolders`))
      unsubscribeFolders = onSnapshot(foldersQuery, (snapshot) => {
        const updatedFolders = snapshot.docs.map(doc => {
          const data = doc.data()
          return {
            id: doc.id,
            name: data.name,
            displayName: data.displayName || data.name,
            path: data.path,
            parentPath: data.parentPath || "",  // Fix: include parentPath for subfolder navigation
            starred: data.starred || false,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date()
          } as FolderItem
        })
        setFolders(updatedFolders.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)))
      })
    }

    return () => {
      unsubscribeFiles()
      unsubscribeFolders()
    }
  }, [user, currentFolder])

  const loadMoreFiles = async () => {
    if (!user || !hasMore || loadingMore || !lastDoc) return

    setLoadingMore(true)
    try {
      const q = query(
        collection(db, `files/${user.uid}/userFiles`),
        orderBy("createdAt", "desc"),
        startAfter(lastDoc),
        limit(50)
      )

      const snapshot = await getDocs(q)

      const newFilesPromises = snapshot.docs.map(async (docSnapshot) => {
        const data = docSnapshot.data()
        let url = data.url
        if (!url && data.storagePath) {
          try { url = await getDownloadURL(ref(storage, data.storagePath)) } catch (e) { }
        }
        return {
          id: docSnapshot.id,
          name: data.displayName || data.name,
          size: Math.round(Number(data.size)),
          type: data.contentType,
          url: url || "",
          fullPath: data.storagePath,
          folder: data.folder || (data.parentPath?.split("/").pop()) || "root",
          uploadedAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          starred: data.starred || false
        } as FileMetadata
      })

      const resolvedNewFiles = await Promise.all(newFilesPromises)
      const validFilteredFiles = resolvedNewFiles.filter(f => currentFolder === "root" ? true : f.folder === currentFolder)

      // We maintain existing files up top via state to append.
      // (Note: To perfectly mix onSnapshot + infinite scroll, you typically need to build your own state 
      // array and only update it on snapshot changes manually. For this fix, appending to existing state works
      // but new documents from snapshot will refresh the whole list. This is an acceptable balance for now).
      setFiles(prev => {
        const existingIds = new Set(prev.map(f => f.id))
        const uniqueNew = validFilteredFiles.filter(f => !existingIds.has(f.id))
        return [...prev, ...uniqueNew]
      })

      if (snapshot.docs.length > 0) {
        setLastDoc(snapshot.docs[snapshot.docs.length - 1])
        setHasMore(snapshot.docs.length === 50)
      } else {
        setHasMore(false)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingMore(false)
    }
  }

  // legacy wrapper to not break props/calls
  const fetchFilesAndFolders = async () => { }


  const fetchFoldersFromFirestore = async (userId: string): Promise<FolderItem[]> => {
    const q = query(collection(db, `folders/${userId}/userFolders`))
    const querySnapshot = await getDocs(q)

    const foldersList: FolderItem[] = []

    querySnapshot.forEach((doc) => {
      const data = doc.data()
      foldersList.push({
        id: doc.id,
        name: data.name,
        displayName: data.displayName || data.name,
        path: data.path,
        parentPath: data.parentPath,
        starred: data.starred || false,
        createdAt: data.createdAt?.toDate(),
      })
    })

    return foldersList.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
  }

  const handleDownload = (file: FileMetadata) => {
    window.open(file.url, "_blank")
  }

  const handlePreview = (file: FileMetadata) => {
    const previewType = getFilePreviewType(file.type)
    if (previewType !== "none") {
      setPreviewFile(file)
    } else {
      toast({
        title: "Preview not available",
        description: "This file type cannot be previewed.",
        variant: "destructive",
      })
    }
  }

  const handleShare = async (file: FileMetadata) => {
    setShareFile(file)
  }

  const handleDeleteFile = async (fullPath: string, name: string, id: string) => {
    if (!confirm(`Are you sure you want to delete ${name}?`)) return

    setIsDeleting(true)
    setDeleteProgress(`Deleting ${name}...`)

    try {
      await deleteFile(fullPath, user!.uid, name, id)
      setFiles(files.filter((f) => f.id !== id))

      // Update storage used locally to reflect change immediately (recalc happens in deleteFile too)
      const fileToDelete = files.find((f) => f.id === id)
      if (userData && fileToDelete) {
        const newStorageUsed = Math.round(userData.storageUsed - fileToDelete.size)
        // Ensure we don't go below 0 visually before the recalc syncs
        await updateStorageUsed(Math.max(0, newStorageUsed))

        if (userData.filesCount !== undefined) {
          await userAuth.updateFilesCount(userData.filesCount - 1)
        }
      }

      toast({
        title: "File deleted",
        description: `${name} has been deleted.`,
      })
    } catch (error) {
      console.error("Error deleting file:", error)
      toast({
        title: "Delete failed",
        description: "Failed to delete the file. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
      setDeleteProgress("")
    }
  }

  const handleToggleStar = async (fileId: string, currentStarred: boolean) => {
    try {
      await toggleFileStarred(user!.uid, fileId, !currentStarred)
      setFileStarred({ ...fileStarred, [fileId]: !currentStarred })
      toast({
        title: currentStarred ? "Removed from starred" : "Added to starred",
        description: currentStarred ? "File removed from starred files" : "File added to starred files",
      })
    } catch (error) {
      console.error("Error toggling star:", error)
      toast({
        title: "Error",
        description: "Failed to update starred status",
        variant: "destructive",
      })
    }
  }

  const handleToggleFolderStar = async (folderId: string, currentStarred: boolean) => {
    if (!user) return

    try {
      await toggleFolderStarred(user.uid, folderId, !currentStarred)
      fetchFilesAndFolders()
      toast({
        title: !currentStarred ? "Added to starred" : "Removed from starred",
      })
    } catch (error) {
      console.error("Error toggling folder star:", error)
      toast({
        title: "Error",
        description: "Failed to update folder",
        variant: "destructive",
      })
    }
  }

  const handleRename = async (fileId: string) => {
    if (!newFileName.trim()) {
      toast({
        title: "Invalid name",
        description: "Please enter a valid file name",
        variant: "destructive",
      })
      return
    }

    try {
      await renameFile(user!.uid, fileId, newFileName.trim())
      setFiles(files.map((f) => (f.id === fileId ? { ...f, name: newFileName.trim() } : f)))
      setRenamingFile(null)
      setNewFileName("")
      toast({
        title: "File renamed",
        description: "File has been renamed successfully",
      })
    } catch (error) {
      console.error("Error renaming file:", error)
      toast({
        title: "Rename failed",
        description: "Failed to rename the file. Please try again.",
        variant: "destructive",
      })
    }
  }

  const handleBulkDelete = async () => {
    if (selectedFiles.length === 0) {
      toast({
        title: "No files selected",
        description: "Please select files to delete.",
        variant: "destructive",
      })
      return
    }

    if (!confirm(`Are you sure you want to delete ${selectedFiles.length} file(s)?`)) return

    setIsDeleting(true)
    setDeleteProgress(`Deleting ${selectedFiles.length} files...`)

    try {
      const filesToDelete = files.filter((f) => selectedFiles.includes(f.id))
      let totalSize = 0

      for (const file of filesToDelete) {
        await deleteFile(file.fullPath, user!.uid, file.name, file.id)
        totalSize += file.size
      }

      setFiles(files.filter((f) => !selectedFiles.includes(f.id)))
      setSelectedFiles([])

      if (userData) {
        const newStorageUsed = Math.round(userData.storageUsed - totalSize)
        await updateStorageUsed(Math.max(0, newStorageUsed))

        if (userData.filesCount !== undefined) {
          await userAuth.updateFilesCount(userData.filesCount - filesToDelete.length)
        }
      }

      toast({
        title: "Files deleted",
        description: `${filesToDelete.length} file(s) deleted successfully.`,
      })
    } catch (error) {
      console.error("Error deleting files:", error)
      toast({
        title: "Delete failed",
        description: "Failed to delete some files. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
      setDeleteProgress("")
    }
  }

  const handleDeleteFolder = async (folderName: string, folderId?: string) => {
    if (!confirm(`Are you sure you want to delete the folder "${folderName}" and all its contents?`)) return

    setIsDeleting(true)
    setDeleteProgress(`Deleting ${folderName}...`)

    try {
      const folderPath = `uploads/${user!.uid}/${folderName}`
      let deletedSize = 0

      if (folderId) {
        // Delete from both Storage and Firestore
        const folder = folders.find((f) => f.id === folderId)
        if (folder) {
          deletedSize = await deleteFolderFromStorage(
            user!.uid,
            folderId,
            folder.path || `uploads/${user!.uid}/${folderName}/`,
          )
        }
      } else {
        // Fallback: delete from Storage only
        const folderRef = ref(storage, folderPath)
        const result = await listAll(folderRef)

        for (const itemRef of result.items) {
          const metadata = await getMetadata(itemRef)
          deletedSize += metadata.size
          await deleteObject(itemRef)
        }

        // Manual recalc for fallback
        await recalculateUserStorage(user!.uid)
      }

      if (userData) {
        const newStorageUsed = Math.round(userData.storageUsed - deletedSize)
        await updateStorageUsed(Math.max(0, newStorageUsed))
      }

      setFolders(folders.filter((f) => f.name !== folderName))

      toast({
        title: "Folder deleted",
        description: `${folderName} and all its contents have been deleted.`,
      })
    } catch (error) {
      console.error("Error deleting folder:", error)
      toast({
        title: "Delete failed",
        description: "Failed to delete the folder. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
      setDeleteProgress("")
    }
  }

  const handleBulkDeleteFolders = async () => {
    if (selectedFolders.length === 0) {
      toast({
        title: "No folders selected",
        description: "Please select folders to delete.",
        variant: "destructive",
      })
      return
    }

    if (!confirm(`Are you sure you want to delete ${selectedFolders.length} folder(s) and all their contents?`)) return

    setIsDeleting(true)
    setDeleteProgress(`Deleting ${selectedFolders.length} folders...`)

    try {
      let totalSize = 0

      for (const folderName of selectedFolders) {
        // Determine if we have an ID for this folder
        const folder = folders.find(f => f.name === folderName);
        if (folder && folder.id) {
          totalSize += await deleteFolderFromStorage(user!.uid, folder.id, folder.path || `uploads/${user!.uid}/${folderName}/`);
        } else {
          // Fallback legacy method
          const folderRef = ref(storage, `uploads/${user!.uid}/${folderName}`)
          const result = await listAll(folderRef)
          for (const itemRef of result.items) {
            const metadata = await getMetadata(itemRef)
            totalSize += metadata.size
            await deleteObject(itemRef)
          }
        }
      }

      // Recalc once
      await recalculateUserStorage(user!.uid)

      setFolders(folders.filter((f) => !selectedFolders.includes(f.name)))
      setSelectedFolders([])

      if (userData) {
        const newStorageUsed = Math.round(userData.storageUsed - totalSize)
        await updateStorageUsed(Math.max(0, newStorageUsed))
      }

      toast({
        title: "Folders deleted",
        description: `${selectedFolders.length} folder(s) deleted successfully.`,
      })
    } catch (error) {
      console.error("Error deleting folders:", error)
      toast({
        title: "Delete failed",
        description: "Failed to delete some folders. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
      setDeleteProgress("")
    }
  }

  const handleRenameFolder = async (folderId: string) => {
    if (!newFolderName.trim()) {
      toast({
        title: "Invalid name",
        description: "Please enter a valid folder name",
        variant: "destructive",
      })
      return
    }

    try {
      await renameFolder(user!.uid, folderId, newFolderName.trim())
      setFolders(folders.map((f) => (f.id === folderId ? { ...f, displayName: newFolderName.trim() } : f)))
      setRenamingFolder(null)
      setNewFolderName("")
      toast({
        title: "Folder renamed",
        description: "Folder has been renamed successfully",
      })
    } catch (error) {
      console.error("Error renaming folder:", error)
      toast({
        title: "Rename failed",
        description: "Failed to rename the folder. Please try again.",
        variant: "destructive",
      })
    }
  }

  const formatDate = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) return "Today"
    if (days === 1) return "Yesterday"
    if (days < 7) return `${days} days ago`
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  const getFileIcon = (type: string) => {
    if (type.includes("image")) return <ImageIcon className="w-10 h-10" />
    if (type.includes("video")) return <Video className="w-10 h-10" />
    if (type.includes("audio")) return <Music className="w-10 h-10" />
    if (type.includes("pdf") || type.includes("document")) return <FileText className="w-10 h-10" />
    return <FileIcon className="w-10 h-10" />
  }

  const getFileBackground = (type: string) => {
    if (type.includes("image"))
      return "bg-gradient-to-br from-purple-100 to-purple-200 dark:from-purple-900/30 dark:to-purple-800/30"
    if (type.includes("video"))
      return "bg-gradient-to-br from-red-100 to-red-200 dark:from-red-900/30 dark:to-red-800/30"
    if (type.includes("audio"))
      return "bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900/30 dark:to-green-800/30"
    if (type.includes("pdf"))
      return "bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-900/30 dark:to-blue-800/30"
    if (type.includes("document"))
      return "bg-gradient-to-br from-yellow-100 to-yellow-200 dark:from-yellow-900/30 dark:to-yellow-800/30"
    return "bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800/30 dark:to-gray-700/30"
  }

  const getFileIconColor = (type: string) => {
    if (type.includes("image")) return "text-purple-600 dark:text-purple-400"
    if (type.includes("video")) return "text-red-600 dark:text-red-400"
    if (type.includes("audio")) return "text-green-600 dark:text-green-400"
    if (type.includes("pdf")) return "text-blue-600 dark:text-blue-400"
    if (type.includes("document")) return "text-yellow-600 dark:text-yellow-400"
    return "text-gray-600 dark:text-gray-400"
  }

  const filteredFiles = files.filter((file) => file.name.toLowerCase().includes(searchQuery.toLowerCase()))

  if (loading && files.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>

        <div className="flex gap-4">
          <Skeleton className="h-10 flex-1 rounded-xl" />
          <Skeleton className="h-10 w-20 rounded-xl" />
        </div>

        <div>
          <Skeleton className="h-6 w-32 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="aspect-square rounded-xl" />
            ))}
          </div>
        </div>

        <div>
          <Skeleton className="h-6 w-32 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-3">
                <Skeleton className="w-full aspect-square rounded-lg" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">My Files</h1>
          <p className="text-foreground/60 mt-1">
            {currentFolder === "root"
              ? "All files"
              : `Folder: ${currentFolder
                .split("/")
                .filter((part) => !part.includes("uploads") && !part.includes("3LS3EhdaqaUDIi7LotV83BKYcj52"))
                .join("/") || "Current Folder"
              }`}
          </p>
        </div>
        <div className="flex gap-2">
          {(selectedFiles.length > 0 || selectedFolders.length > 0) && (
            <>
              {selectedFiles.length > 0 && (
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center gap-2 px-4 py-2 bg-destructive hover:bg-destructive/90 text-white rounded-lg transition font-medium"
                >
                  <Trash2 size={18} />
                  <span>Delete {selectedFiles.length} file(s)</span>
                </button>
              )}
              {selectedFolders.length > 0 && (
                <button
                  onClick={handleBulkDeleteFolders}
                  className="flex items-center gap-2 px-4 py-2 bg-destructive hover:bg-destructive/90 text-white rounded-lg transition font-medium"
                >
                  <Trash2 size={18} />
                  <span>Delete {selectedFolders.length} folder(s)</span>
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setShowCreateFolder(true)}
            className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition"
          >
            <FolderPlus size={18} />
            <span className="hidden sm:inline">New Folder</span>
          </button>
          <button
            onClick={() => setUploadToFolder(currentFolder)}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition"
          >
            <Upload size={18} />
            <span className="hidden sm:inline">Upload Files</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/40" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-card border border-border rounded-xl text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div className="flex gap-2 bg-card border border-border rounded-xl p-1">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-2 rounded-lg transition ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:bg-muted"
              }`}
            title="Grid view"
          >
            <Grid3x3 size={20} />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-2 rounded-lg transition ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:bg-muted"
              }`}
            title="List view"
          >
            <List size={20} />
          </button>
        </div>
      </div>

      {/* Folders Grid */}
      {folders.length > 0 && (
        <div>
          <h3 className="text-xl font-bold text-foreground mb-4">Folders</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {folders.map((folder) => (
              <div className="group relative bg-card border border-border rounded-xl p-4 hover:shadow-lg hover:border-primary/30 transition-all">
                {/* Folder checkbox */}
                <div className={`absolute top-3 left-3 z-10 transition-opacity ${selectedFolders.length > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedFolders((prev) =>
                        prev.includes(folder.name) ? prev.filter((n) => n !== folder.name) : [...prev, folder.name]
                      )
                    }}
                    className="p-1 hover:scale-110 transition-transform"
                    title="Select folder"
                  >
                    {selectedFolders.includes(folder.name) ? (
                      <CheckSquare size={18} className="text-primary" />
                    ) : (
                      <Square size={18} className="text-foreground/40" />
                    )}
                  </button>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (folder.id) handleToggleFolderStar(folder.id, folder.starred || false)
                  }}
                  className="absolute top-3 right-3 z-10 p-1.5 hover:bg-muted rounded-lg transition"
                >
                  <Star
                    size={18}
                    className={folder.starred ? "fill-yellow-400 text-yellow-400" : "text-foreground/40"}
                  />
                </button>

                <button
                  onClick={() => setCurrentFolder(folder.path)}
                  className="w-full aspect-square bg-gradient-to-br from-yellow-50 to-yellow-100 dark:from-yellow-900/20 dark:to-yellow-800/20 rounded-xl flex items-center justify-center mb-3 hover:scale-105 transition-transform"
                >
                  <Folder className="w-20 h-20 text-yellow-600 dark:text-yellow-500" />
                </button>

                <div className="space-y-2">
                  {renamingFolder === folder.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (folder.id) handleRenameFolder(folder.id)
                      }}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        className="flex-1 px-2 py-1 text-sm border border-border rounded bg-background"
                        autoFocus
                      />
                      <button type="submit" className="text-xs text-primary hover:underline">
                        Save
                      </button>
                    </form>
                  ) : (
                    <h4 className="font-semibold text-foreground truncate">{folder.displayName}</h4>
                  )}
                  <p className="text-xs text-foreground/60">
                    {folder.createdAt ? new Date(folder.createdAt).toLocaleDateString() : ""}
                  </p>

                  <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                    <button
                      onClick={() => setCurrentFolder(folder.path)}
                      className="p-1.5 hover:bg-primary/10 rounded-lg transition text-primary"
                      title="Open folder"
                    >
                      <Eye size={16} />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setRenamingFolder(folder.id || null)
                        setNewFolderName(folder.displayName)
                      }}
                      className="p-1.5 hover:bg-primary/10 rounded-lg transition text-foreground/60"
                      title="Rename folder"
                    >
                      <Edit2 size={16} />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShareFolder(folder)
                      }}
                      className="p-1.5 hover:bg-primary/10 rounded-lg transition text-foreground/60"
                      title="Share folder"
                    >
                      <Share2 size={16} />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteFolder(folder.name, folder.id)
                      }}
                      className="p-1.5 hover:bg-destructive/10 rounded-lg transition text-destructive ml-auto"
                      title="Delete folder"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {currentFolder !== "root" && (
        <button
          onClick={() => setCurrentFolder("root")}
          className="flex items-center gap-2 text-primary hover:text-primary/80 transition"
        >
          <Folder size={18} />
          <span>Back to all files</span>
        </button>
      )}

      {filteredFiles.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <FileIcon className="w-16 h-16 text-foreground/20 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-foreground mb-2">
            {searchQuery ? "No files found" : "No files yet"}
          </h3>
          <p className="text-foreground/60">
            {searchQuery ? "Try a different search term" : "Upload your first file to get started"}
          </p>
        </div>
      ) : (
        <>
          {viewMode === "grid" ? (
            <div>
              <h3 className="text-xl font-bold text-foreground mb-4">Files</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredFiles.map((file) => (
                  <div
                    key={file.id}
                    className={`group relative bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg hover:border-primary/30 transition-all ${selectedFiles.includes(file.id) ? "ring-2 ring-primary" : ""}`}
                  >
                    {/* File checkbox */}
                    <div className={`absolute top-3 left-3 z-10 transition-opacity ${selectedFiles.length > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedFiles((prev) =>
                            prev.includes(file.id) ? prev.filter((id) => id !== file.id) : [...prev, file.id]
                          )
                        }}
                        className="p-1 hover:scale-110 transition-transform"
                        title="Select file"
                      >
                        {selectedFiles.includes(file.id) ? (
                          <CheckSquare size={18} className="text-primary" />
                        ) : (
                          <Square size={18} className="text-foreground/40" />
                        )}
                      </button>
                    </div>
                    {/* Star icon */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleStar(file.id, fileStarred[file.id] || false)
                      }}
                      className="absolute top-3 right-3 z-10 p-1.5 hover:bg-muted rounded-lg transition"
                    >
                      <Star
                        size={18}
                        className={fileStarred[file.id] ? "fill-yellow-400 text-yellow-400" : "text-foreground/40"}
                      />
                    </button>

                    {/* File preview area */}
                    <div
                      className={`aspect-square ${getFileBackground(file.type)} flex items-center justify-center overflow-hidden ${file.type.startsWith("image/") && file.url ? "" : "p-6"
                        }`}
                    >
                      {file.type.startsWith("image/") && file.url ? (
                        <img
                          src={file.url}
                          alt={file.name}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                          loading="lazy"
                        />
                      ) : (
                        <div className={getFileIconColor(file.type)}>{getFileIcon(file.type)}</div>
                      )}
                    </div>

                    {/* File info */}
                    <div className="p-4 space-y-3">
                      {renamingFile === file.id ? (
                        <input
                          type="text"
                          value={newFileName}
                          onChange={(e) => setNewFileName(e.target.value)}
                          onBlur={() => handleRename(file.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(file.id)
                            if (e.key === "Escape") {
                              setRenamingFile(null)
                              setNewFileName("")
                            }
                          }}
                          autoFocus
                          className="w-full px-2 py-1 text-sm border rounded"
                        />
                      ) : (
                        <div>
                          <h4 className="font-semibold text-foreground truncate text-sm">{file.name}</h4>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-xs text-foreground/60">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                            <p className="text-xs text-foreground/60">
                              {new Date(file.uploadedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-3 border-t border-border/50">
                        <button
                          onClick={() => handlePreview(file)}
                          className="p-1.5 hover:bg-primary/10 rounded-lg transition text-primary"
                          title="Preview file"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => {
                            setRenamingFile(file.id)
                            setNewFileName(file.name)
                          }}
                          className="p-1.5 hover:bg-primary/10 rounded-lg transition text-foreground/60"
                          title="Rename file"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => setShareFile(file)}
                          className="p-1.5 hover:bg-primary/10 rounded-lg transition text-foreground/60"
                          title="Share file"
                        >
                          <Share2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDownload(file)}
                          className="p-1.5 hover:bg-primary/10 rounded-lg transition text-foreground/60"
                          title="Download file"
                        >
                          <Download size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteFile(file.fullPath, file.name, file.id)}
                          className="p-1.5 hover:bg-destructive/10 rounded-lg transition text-destructive ml-auto"
                          title="Delete file"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {hasMore && filteredFiles.length > 0 && (
                <div className="mt-8 flex justify-center">
                  <button
                    onClick={loadMoreFiles}
                    disabled={loadingMore}
                    className="px-6 py-2 bg-muted hover:bg-muted/80 text-foreground font-medium rounded-xl transition flex items-center justify-center min-w-[150px]"
                  >
                    {loadingMore ? <Loader2 className="w-5 h-5 animate-spin mx-auto text-primary" /> : "Load More"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="max-h-[600px] overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="px-6 py-4 text-left">
                        <input
                          type="checkbox"
                          checked={selectedFiles.length === filteredFiles.length && filteredFiles.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedFiles(filteredFiles.map((f) => f.id))
                            } else {
                              setSelectedFiles([])
                            }
                          }}
                          className="rounded"
                        />
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-foreground/70">Name</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-foreground/70">Size</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-foreground/70">Uploaded</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-foreground/70">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredFiles.map((file) => (
                      <tr key={file.id} className="hover:bg-muted/30 transition-colors group">
                        <td className="px-6 py-4">
                          <input
                            type="checkbox"
                            checked={selectedFiles.includes(file.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedFiles([...selectedFiles, file.id])
                              } else {
                                setSelectedFiles(selectedFiles.filter((id) => id !== file.id))
                              }
                            }}
                            className="rounded"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                              <FileIcon className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{file.name}</p>
                              <p className="text-xs text-foreground/50">{file.type}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-foreground/70">{(file.size / 1024 / 1024).toFixed(2)} MB</td>
                        <td className="px-6 py-4 text-foreground/70 text-sm">
                          {new Date(file.uploadedAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handlePreview(file)}
                              className="p-2 hover:bg-primary/10 rounded-lg transition"
                              title="View"
                            >
                              <Eye size={18} className="text-primary" />
                            </button>
                            <button
                              onClick={() => handleDownload(file)}
                              className="p-2 hover:bg-muted rounded-lg transition"
                              title="Download"
                            >
                              <Download size={18} className="text-foreground/60" />
                            </button>
                            <button
                              onClick={() => handleShare(file)}
                              className="p-2 hover:bg-muted rounded-lg transition"
                              title="Share"
                            >
                              <Share2 size={18} className="text-foreground/60" />
                            </button>
                            <button
                              onClick={() => handleDeleteFile(file.fullPath, file.name, file.id)}
                              className="p-2 hover:bg-muted rounded-lg transition"
                              title="Delete"
                            >
                              <Trash2 size={18} className="text-destructive" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {hasMore && filteredFiles.length > 0 && (
                  <div className="p-4 flex justify-center border-t border-border">
                    <button
                      onClick={loadMoreFiles}
                      disabled={loadingMore}
                      className="px-6 py-2 bg-muted hover:bg-muted/80 text-foreground font-medium rounded-xl transition flex items-center justify-center min-w-[150px]"
                    >
                      {loadingMore ? <Loader2 className="w-5 h-5 animate-spin mx-auto text-primary" /> : "Load More"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
      {shareFile && (
        <ShareLinkModal
          file={shareFile}
          onClose={() => setShareFile(null)}
          onSuccess={() => {
            setShareFile(null)
            toast({
              title: "Link created",
              description: "Share link has been created successfully.",
            })
          }}
        />
      )}
      {showCreateFolder && (
        <CreateFolderModal
          onClose={() => setShowCreateFolder(false)}
          onSuccess={() => {
            setShowCreateFolder(false)
            fetchFilesAndFolders()
          }}
        />
      )}
      {uploadToFolder && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-foreground">
                Upload to {uploadToFolder === "root" ? "Root Folder" : uploadToFolder.split("/").pop() || "Folder"}
              </h2>
              <button
                onClick={() => setUploadToFolder(null)}
                className="text-foreground/60 hover:text-foreground transition"
              >
                Close
              </button>
            </div>
            <FileUpload
              folder={uploadToFolder === "root" ? "" : uploadToFolder}
              onUploadComplete={() => {
                setUploadToFolder(null)
                fetchFilesAndFolders()
              }}
            />
          </div>
        </div>
      )}
      {shareFolder && (
        <ShareLinkModal
          file={{
            id: shareFolder.id || shareFolder.name,
            name: shareFolder.name,
            size: 0,
            type: "folder",
            url: "",
            isFolder: true,
          } as any}
          onClose={() => setShareFolder(null)}
        />
      )}

      <AlertDialog open={isDeleting} onOpenChange={() => { }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deleting...</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col items-center justify-center py-4 gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p>{deleteProgress}</p>
              <p className="text-sm text-muted-foreground">Please wait while we delete your files.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
