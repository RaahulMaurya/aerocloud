import { ref, uploadBytesResumable, getDownloadURL, deleteObject, listAll, getMetadata } from "firebase/storage"
import { doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, deleteDoc, limit, startAfter, getCountFromServer, orderBy, increment, updateDoc } from "firebase/firestore"
import { storage, db } from "@/lib/firebase"
import { bytesToGB } from "@/lib/razorpay"
import { checkRateLimit, validateUploadQuota } from "@/lib/rate-limit"
import { handleError, logError, type AppError } from "@/lib/error-handler"
import { sanitizeFileName, sanitizeFolderName, isSuspiciousFileName } from "@/lib/input-sanitizer"
import { appCache, invalidateUserCache, CACHE_KEYS } from "@/lib/cache-manager"

// Recalculate and save total storage used by user
export async function recalculateUserStorage(userId: string): Promise<number> {
  // Try to use a faster approach if there are many files.
  // We'll keep the listUserFiles but ideally this runs in a cloud function.
  const files = await listUserFiles(userId)
  const totalBytes = files.reduce((acc, file) => acc + (file.size || 0), 0)

  const userDocRef = doc(db, "users", userId)
  await setDoc(userDocRef, { storageUsed: totalBytes }, { merge: true })

  // Also invalidate cache if needed, though listUserFiles might use it? 
  // Probably fine.

  return totalBytes
}

export async function getAccurateFileCount(userId: string): Promise<number> {
  try {
    const q = query(collection(db, `files/${userId}/userFiles`));
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
  } catch (error) {
    console.error("Error getting file count:", error);
    return 0; // fallback securely
  }
}

const BLOCKED_FILE_TYPES: string[] = [] // Allow all file types
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

export interface FileMetadata {
  id: string
  name: string
  size: number
  sizeGB: number
  type: string
  url: string
  uploadedAt: Date
  fullPath: string
  folder?: string
  starred?: boolean
}

export interface SharedLink {
  id: string
  fileId: string
  fileName: string
  fileUrl: string
  storagePath?: string
  fileSize: number
  sharedBy: string
  createdAt: Date
  expiresAt: Date
  isExpired: boolean
}

export interface ActivityLog {
  id: string
  userId: string
  action: string
  fileName: string
  fileType: string
  timestamp: Date
  details: string
}

// Upload file to Firebase Storage with production-ready features
export async function uploadFile(
  userId: string,
  file: File,
  folder = "root",
  onProgress?: (progress: number) => void,
  fileName?: string,
  abortSignal?: AbortSignal,
  pausedFilesRef?: Set<string>,
  fileIdFromComponent?: string,
  currentStorageUsed?: number,
  maxStorage?: number,
): Promise<FileMetadata> {
  try {
    // Rate limiting check
    if (!checkRateLimit(userId)) {
      throw new Error("Rate limit exceeded. Please wait before uploading more files.")
    }

    // Quota check
    if (currentStorageUsed !== undefined && maxStorage !== undefined) {
      if (currentStorageUsed + file.size > maxStorage) {
        throw new Error("Storage quota exceeded. Please upgrade your plan to upload more files.")
      }
    }

    // File validation - only basic validation, backend handles quota
    const validation = validateFileUpload(file)
    if (!validation.valid) {
      throw new Error(validation.error || "File validation failed")
    }

    // Sanitize file and folder names
    const sanitizedFileName = sanitizeFileName(fileName || file.name)
    const sanitizedFolder = sanitizeFolderName(folder)

    // Use fileId from component if provided, otherwise generate one
    const fileId = fileIdFromComponent || `${Date.now()}_${sanitizedFileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`

    let storagePath: string
    let parentPath: string

    if (sanitizedFolder === "root" || sanitizedFolder === "") {
      storagePath = `uploads/${userId}/${fileId}`
      parentPath = `uploads/${userId}/`
    } else if (sanitizedFolder.startsWith("uploads/")) {
      storagePath = `${sanitizedFolder}${sanitizedFolder.endsWith("/") ? "" : "/"}${fileId}`
      parentPath = sanitizedFolder.endsWith("/") ? sanitizedFolder : `${sanitizedFolder}/`
    } else {
      storagePath = `uploads/${userId}/${sanitizedFolder}/${fileId}`
      parentPath = `uploads/${userId}/${sanitizedFolder}/`
    }

    console.log("Upload starting - file:", sanitizedFileName, "path:", storagePath, "fileId:", fileId)

    const storageRef = ref(storage, storagePath)

    return new Promise((resolve, reject) => {
      const uploadTask = uploadBytesResumable(storageRef, file)
      let pauseCheckInterval: NodeJS.Timeout | null = null
      let isPausedLocally = false

      // Handle abort signal
      const unsubscribeAbort = () => {
        uploadTask.cancel()
        if (pauseCheckInterval) clearInterval(pauseCheckInterval)
        reject(new Error("Upload cancelled by user"))
      }

      if (abortSignal) {
        if (abortSignal.aborted) {
          uploadTask.cancel()
          return reject(new Error("Upload cancelled"))
        }
        abortSignal.addEventListener("abort", unsubscribeAbort)
      }

      // Monitor pause status and pause/resume accordingly
      pauseCheckInterval = setInterval(() => {
        const shouldBePaused = fileId && pausedFilesRef?.has(fileId)

        if (shouldBePaused && !isPausedLocally) {
          uploadTask.pause()
          isPausedLocally = true
        } else if (!shouldBePaused && isPausedLocally) {
          uploadTask.resume()
          isPausedLocally = false
        }
      }, 50)

      uploadTask.on(
        "state_changed",
        (snapshot) => {
          // Check if upload was aborted
          if (abortSignal?.aborted) {
            uploadTask.cancel()
            if (pauseCheckInterval) clearInterval(pauseCheckInterval)
            if (abortSignal) {
              abortSignal.removeEventListener("abort", unsubscribeAbort)
            }
            return reject(new Error("Upload cancelled"))
          }

          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          onProgress?.(progress)
        },
        (error) => {
          if (pauseCheckInterval) clearInterval(pauseCheckInterval)
          if (abortSignal) {
            abortSignal.removeEventListener("abort", unsubscribeAbort)
          }
          const appError = handleError(error)
          logError(appError)
          reject(new Error(`Upload failed: ${appError.userMessage}`))
        },
        async () => {
          try {
            if (pauseCheckInterval) clearInterval(pauseCheckInterval)
            if (abortSignal) {
              abortSignal.removeEventListener("abort", unsubscribeAbort)
            }

            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref)

            const fileData = {
              fileId,
              name: file.name,
              displayName: sanitizedFileName,
              size: file.size,
              contentType: file.type,
              storagePath: storageRef.fullPath,
              parentPath: parentPath,
              path: storageRef.fullPath,
              createdAt: new Date(),
              updatedAt: new Date(),
              starred: false,
              url: downloadURL, // Save URL to avoid re-fetching
              folder: sanitizedFolder || "root", // Save folder for easier querying
            }

            // Store in files/{userId}/userFiles/{fileId} collection
            const fileDocRef = doc(db, `files/${userId}/userFiles`, fileId)
            await setDoc(fileDocRef, fileData)

            console.log("File saved to Firestore:", fileId)

            const metadata: FileMetadata = {
              id: fileId,
              name: sanitizedFileName,
              size: file.size,
              sizeGB: bytesToGB(file.size),
              type: file.type,
              url: downloadURL,
              uploadedAt: new Date(),
              fullPath: storageRef.fullPath,
              folder: sanitizedFolder,
            }

            // Invalidate cache
            invalidateUserCache(userId)

            // Log activity
            await addActivityLog(userId, "upload", sanitizedFileName, file.type, `Uploaded ${sanitizedFileName}`)

            // Atomically increment storageUsed and filesCount — O(1), no full scan needed
            try {
              const userDocRef = doc(db, "users", userId)
              await updateDoc(userDocRef, {
                storageUsed: increment(file.size),
                filesCount: increment(1),
              })
            } catch (counterError) {
              // Non-fatal: counters will be corrected on next recalculate
              console.warn("Could not update storage counter:", counterError)
            }

            resolve(metadata)
          } catch (error) {
            console.error("Error saving file metadata:", error)
            const appError = handleError(error)
            logError(appError)
            reject(new Error("Failed to save file metadata"))
          }
        },
      )
    })
  } catch (error) {
    const appError = handleError(error)
    logError(appError)
    throw error
  }
}

interface ValidationResult {
  valid: boolean
  error?: string
}

function validateFileUpload(file: File): ValidationResult {
  // Check file size
  if (file.size === 0) {
    return { valid: false, error: "Empty files cannot be uploaded" }
  }

  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: "File size exceeds 5GB limit" }
  }

  // Check for blocked file types
  if (BLOCKED_FILE_TYPES.includes(file.type)) {
    return { valid: false, error: "This file type is not allowed for security reasons" }
  }

  // Check file name validity
  if (!file.name || file.name.trim() === "") {
    return { valid: false, error: "File must have a valid name" }
  }

  if (file.name.length > 255) {
    return { valid: false, error: "File name is too long (max 255 characters)" }
  }

  return { valid: true }
}

// Delete file from Firebase Storage
export async function deleteFile(fullPath: string, userId: string, fileName: string, fileId?: string): Promise<void> {
  // 1. Read file size BEFORE deletion so we can atomically decrement storageUsed
  let fileSize = 0
  try {
    if (fileId) {
      const fileDocRef = doc(db, `files/${userId}/userFiles`, fileId)
      const snap = await getDoc(fileDocRef)
      if (snap.exists()) fileSize = Math.round(Number(snap.data()?.size)) || 0
    }
    // Fallback: read from Storage metadata if Firestore size not found
    if (!fileSize) {
      const meta = await getMetadata(ref(storage, fullPath))
      fileSize = meta.size || 0
    }
  } catch (_) { /* size unknown — decrement will be 0, count still decrements */ }

  // 2. Delete from Storage
  const fileRef = ref(storage, fullPath)
  await deleteObject(fileRef)

  // 3. Delete from Firestore - try with fileId first, then search by storagePath
  if (fileId) {
    const fileDocRef = doc(db, `files/${userId}/userFiles`, fileId)
    await deleteDoc(fileDocRef)
    console.log("Deleted file from Firestore by ID:", fileId)
  } else {
    // Search for file by storagePath and delete
    const q = query(collection(db, `files/${userId}/userFiles`), where("storagePath", "==", fullPath))
    const querySnapshot = await getDocs(q)

    for (const docSnapshot of querySnapshot.docs) {
      await deleteDoc(docSnapshot.ref)
      console.log("Deleted file from Firestore by path:", docSnapshot.id)
    }
  }

  // 4. Log activity
  await addActivityLog(userId, "delete", fileName, "", `Deleted ${fileName}`)

  // 5. Atomically decrement storageUsed and filesCount — O(1), no full scan
  try {
    const userDocRef = doc(db, "users", userId)
    await updateDoc(userDocRef, {
      storageUsed: increment(-Math.abs(fileSize)),
      filesCount: increment(-1),
    })
  } catch (counterError) {
    console.warn("Could not update storage counter after delete:", counterError)
  }
}

export async function listUserFilesPaginated(
  userId: string,
  lastDoc: any = null,
  pageSize: number = 50
) {
  try {
    let q = query(
      collection(db, `files/${userId}/userFiles`),
      orderBy("createdAt", "desc"),
      limit(pageSize)
    );

    if (lastDoc) {
      q = query(
        collection(db, `files/${userId}/userFiles`),
        orderBy("createdAt", "desc"),
        startAfter(lastDoc),
        limit(pageSize)
      );
    }

    const querySnapshot = await getDocs(q);

    // Explicit mapping to load files efficiently
    const validFiles = await Promise.all(
      querySnapshot.docs.map(async (docSnapshot) => {
        const data = docSnapshot.data();
        let url = data.url;

        // Ensure legacy files map safely if URL is missing
        if (!url && data.storagePath) {
          try {
            url = await getDownloadURL(ref(storage, data.storagePath));
          } catch (e) {
            console.log("Could not get fallback URL", e);
          }
        }

        return {
          id: docSnapshot.id,
          name: data.displayName || data.name,
          size: Math.round(Number(data.size)),
          sizeGB: bytesToGB(Math.round(Number(data.size))),
          type: data.contentType || "unknown",
          url: url || "",
          uploadedAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          fullPath: data.storagePath,
          folder: data.folder || (data.parentPath?.split("/").pop()) || "root",
          starred: data.starred || false,
        } as FileMetadata;
      })
    );

    return {
      files: validFiles.filter(f => f.url), // Need valid URL
      lastDoc: querySnapshot.docs.length === pageSize ? querySnapshot.docs[querySnapshot.docs.length - 1] : null
    };
  } catch (error) {
    console.error("Error paginating files:", error);
    return { files: [], lastDoc: null };
  }
}

// List all user files with folder support (Optimized fallback for backward comp)
export async function listUserFiles(userId: string, folder = ""): Promise<FileMetadata[]> {
  try {
    // 1. Attempt to query by folder field first (Optimized path)
    // Note: This requires an index if combining with orderby, but for now we'll sort in memory if needed or simple query
    let q;

    // Check if we assume most files have the new 'folder' field. 
    // We can't easily mix "has folder" and "legacy" in one query without complex logic.
    // For now, let's fetch all and filter in memory BUT optimized with concurrency.
    // OR: We can try a compound query if we are confident.
    // Let's stick to the reliable "fetch all then filter" but OPTIMIZED concurrency for now 
    // to ensure legacy files (without 'folder' field) still show up until migrated.
    // ACTUALLY, checking 100s of files is slow. 
    // Let's try to filter by folder if the user passed one.

    // STRATEGY: 
    // If folder is provided, we prefer to use the 'folder' field. 
    // But legacy files don't have it. stored 'parentPath' might be useful but regex is not supported in firestore.
    // To safe fix legacy files: We will fetch all (or limit) but process in PARALLEL.

    q = query(collection(db, `files/${userId}/userFiles`))
    const querySnapshot = await getDocs(q)

    const filesPromises = querySnapshot.docs.map(async (docSnapshot) => {
      const data = docSnapshot.data()

      if (!data.storagePath || typeof data.storagePath !== "string" || data.storagePath.trim() === "") {
        return null
      }

      // Filter by folder (In-memory for legacy support)
      // Use 'folder' field if exists, otherwise fallback to parsing parentPath
      const fileFolder = data.folder || (data.parentPath?.split("/").pop()) || "root"

      // Normalize comparison (handle null/undefined/empty string as 'root')
      const targetFolder = folder || "root"
      const currentFileFolder = fileFolder || "root"

      if (currentFileFolder !== targetFolder) {
        return null
      }

      try {
        // Use stored URL if available to save network calls
        let url = data.url
        if (!url) {
          url = await getDownloadURL(ref(storage, data.storagePath))
        }

        return {
          id: docSnapshot.id,
          name: data.displayName || data.name,
          size: Math.round(Number(data.size)),
          sizeGB: bytesToGB(Math.round(Number(data.size))),
          type: data.contentType || "unknown",
          url,
          uploadedAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          fullPath: data.storagePath,
          folder: fileFolder,
          starred: data.starred || false,
        } as FileMetadata
      } catch (error) {
        console.error(`Error getting download URL for ${data.name}:`, error)
        return null
      }
    })

    const results = await Promise.all(filesPromises)
    const validFiles = results.filter((f): f is FileMetadata => f !== null)

    return validFiles.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
  } catch (error) {
    // ... fallback code remains same
    console.error("Error listing files from Firestore:", error)
    // Fallback to storage listing
    const folderPath = folder ? `${folder}/` : ""
    const listRef = ref(storage, `uploads/${userId}/${folderPath}`)
    const result = await listAll(listRef)

    const filesPromises = result.items.map(async (itemRef) => {
      const [url, metadata] = await Promise.all([getDownloadURL(itemRef), getMetadata(itemRef)])

      return {
        id: itemRef.name,
        name: metadata.name,
        size: Math.round(metadata.size),
        sizeGB: bytesToGB(Math.round(metadata.size)),
        type: metadata.contentType || "unknown",
        url,
        uploadedAt: new Date(metadata.timeCreated),
        fullPath: itemRef.fullPath,
        folder: folder || "root",
        starred: false,
      }
    })

    return Promise.all(filesPromises)
  }
}

// List all folders for a user
export async function listUserFolders(userId: string): Promise<string[]> {
  const listRef = ref(storage, `uploads/${userId}`)
  const result = await listAll(listRef)
  return result.prefixes.map((prefix) => prefix.name)
}

// Calculate total storage used by user
export async function calculateTotalStorage(userId: string): Promise<number> {
  const files = await listUserFiles(userId)
  const totalBytes = files.reduce((acc, file) => acc + file.size, 0)
  return bytesToGB(totalBytes)
}

// Create a shared link for a file
export async function createSharedLink(
  userId: string,
  fileId: string,
  fileName: string,
  fileUrl: string,
  fileSize: number,
  userFileToURLPlan?: string,
  storagePath?: string,
): Promise<SharedLink> {
  const { FILE_TO_URL_PLANS } = await import("@/lib/razorpay")

  const plan = userFileToURLPlan ? FILE_TO_URL_PLANS[userFileToURLPlan] : FILE_TO_URL_PLANS.free
  const now = new Date()

  // Calculate expiration based on plan
  let expiresAt: Date
  if (plan.expirationDays === 0) {
    // Never expires - set to 100 years
    expiresAt = new Date(now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000)
  } else {
    expiresAt = new Date(now.getTime() + plan.expirationDays * 24 * 60 * 60 * 1000)
  }

  const sharedLinkData = {
    fileId,
    fileName,
    fileUrl,
    storagePath: storagePath || undefined,
    fileSize,
    sharedBy: userId,
    createdAt: now,
    expiresAt,
    fileToURLPlan: userFileToURLPlan || "free",
    isExpired: false,
  }

  const docRef = await addDoc(collection(db, "sharedLinks"), sharedLinkData)

  // Log activity
  await addActivityLog(userId, "share", fileName, "", `Created shared link for ${fileName}`)

  return {
    id: docRef.id,
    ...sharedLinkData,
  }
}

// Get all shared links for a user
export async function getUserSharedLinks(userId: string): Promise<SharedLink[]> {
  const q = query(collection(db, "sharedLinks"), where("sharedBy", "==", userId))
  const querySnapshot = await getDocs(q)

  const links: SharedLink[] = []
  const now = new Date()

  for (const doc of querySnapshot.docs) {
    const data = doc.data()
    const expiresAt = data.expiresAt.toDate()
    const isExpired = expiresAt < now

    // Update expired status if needed
    if (isExpired && !data.isExpired) {
      await setDoc(doc.ref, { isExpired: true }, { merge: true })
    }

    links.push({
      id: doc.id,
      fileId: data.fileId,
      fileName: data.fileName,
      fileUrl: data.fileUrl,
      fileSize: data.fileSize,
      sharedBy: data.sharedBy,
      createdAt: data.createdAt.toDate(),
      expiresAt,
      isExpired,
    })
  }

  return links.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

// Get a shared link by id
export async function getSharedLink(linkId: string): Promise<SharedLink | null> {
  const docRef = doc(db, "sharedLinks", linkId)
  const docSnap = await getDoc(docRef)

  if (!docSnap.exists()) return null

  const data = docSnap.data()
  const expiresAt = data.expiresAt.toDate()
  const now = new Date()
  const isExpired = expiresAt < now

  if (isExpired) {
    return null
  }

  return {
    id: docSnap.id,
    fileId: data.fileId,
    fileName: data.fileName,
    fileUrl: data.fileUrl,
    storagePath: data.storagePath,
    fileSize: data.fileSize,
    sharedBy: data.sharedBy,
    createdAt: data.createdAt.toDate(),
    expiresAt,
    isExpired,
  }
}

// Delete a shared link
export async function deleteSharedLink(linkId: string): Promise<void> {
  await deleteDoc(doc(db, "sharedLinks", linkId))
}

// Add activity log
export async function addActivityLog(
  userId: string,
  action: string,
  fileName: string,
  fileType: string,
  details: string,
): Promise<void> {
  await addDoc(collection(db, "activityLogs"), {
    userId,
    action,
    fileName,
    fileType,
    timestamp: new Date(),
    details,
  })
}

// Get user activity logs
export async function getUserActivityLogs(userId: string, limit = 20): Promise<ActivityLog[]> {
  const q = query(collection(db, "activityLogs"), where("userId", "==", userId))
  const querySnapshot = await getDocs(q)

  const logs: ActivityLog[] = []
  querySnapshot.forEach((doc) => {
    const data = doc.data()
    logs.push({
      id: doc.id,
      userId: data.userId,
      action: data.action,
      fileName: data.fileName,
      fileType: data.fileType,
      timestamp: data.timestamp.toDate(),
      details: data.details,
    })
  })

  return logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit)
}

// Get file type for preview
export function getFilePreviewType(mimeType: string): "image" | "video" | "pdf" | "document" | "none" {
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType === "application/pdf") return "pdf"

  const docTypes = [
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
  ]
  if (docTypes.includes(mimeType)) return "document"

  return "none"
}

// Delete folder from Firebase Storage and Firestore
export async function deleteFolder(userId: string, folderId: string, folderPath: string): Promise<number> {
  // Delete all files in the folder from Storage
  const folderRef = ref(storage, folderPath)
  const result = await listAll(folderRef)

  let totalSize = 0

  // Delete each file from both Storage and Firestore
  for (const itemRef of result.items) {
    try {
      const metadata = await getMetadata(itemRef)
      totalSize += metadata.size

      // Delete from Storage
      await deleteObject(itemRef)

      // Find and delete corresponding Firestore document
      const q = query(collection(db, `files/${userId}/userFiles`), where("storagePath", "==", itemRef.fullPath))
      const querySnapshot = await getDocs(q)

      for (const docSnapshot of querySnapshot.docs) {
        await deleteDoc(docSnapshot.ref)
        console.log("Deleted file from Firestore:", docSnapshot.id)
      }
    } catch (error) {
      console.error("Error deleting file:", itemRef.fullPath, error)
    }
  }

  // Delete folder document from Firestore
  const folderDocRef = doc(db, `folders/${userId}/userFolders`, folderId)
  await deleteDoc(folderDocRef)

  // Log activity
  await addActivityLog(userId, "delete", folderPath.split("/").pop() || "folder", "", `Deleted folder ${folderPath}`)

  // Recalculate storage
  const currentTotal = await recalculateUserStorage(userId)

  return totalSize
}

// Delete activity log
export async function deleteActivityLog(logId: string): Promise<void> {
  await deleteDoc(doc(db, "activityLogs", logId))
}

export async function toggleFileStarred(userId: string, fileId: string, starred: boolean): Promise<void> {
  const fileDocRef = doc(db, `files/${userId}/userFiles`, fileId)
  await setDoc(fileDocRef, { starred, updatedAt: new Date() }, { merge: true })
}

export async function renameFile(userId: string, fileId: string, newName: string): Promise<void> {
  const fileDocRef = doc(db, `files/${userId}/userFiles`, fileId)
  await setDoc(fileDocRef, { displayName: newName, name: newName, updatedAt: new Date() }, { merge: true })

  // Log activity
  await addActivityLog(userId, "rename", newName, "", `Renamed file to ${newName}`)
}

export async function getStarredFiles(userId: string): Promise<FileMetadata[]> {
  const q = query(collection(db, `files/${userId}/userFiles`), where("starred", "==", true))
  const querySnapshot = await getDocs(q)

  const starredFiles: FileMetadata[] = []

  for (const docSnapshot of querySnapshot.docs) {
    const data = docSnapshot.data()

    if (!data.storagePath || typeof data.storagePath !== "string" || data.storagePath.trim() === "") {
      console.error(`Skipping starred file with invalid storagePath:`, docSnapshot.id)
      continue
    }

    try {
      const url = await getDownloadURL(ref(storage, data.storagePath))
      starredFiles.push({
        id: docSnapshot.id,
        name: data.displayName || data.name,
        size: Math.round(Number(data.size)),
        sizeGB: bytesToGB(Math.round(Number(data.size))),
        type: data.contentType || "unknown",
        url,
        uploadedAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
        fullPath: data.storagePath,
        folder: data.parentPath?.split("/").pop() || "root",
        starred: true,
      })
    } catch (error) {
      console.error(`Error getting download URL for ${data.name}:`, error)
    }
  }

  return starredFiles.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
}

export async function toggleFolderStarred(userId: string, folderId: string, starred: boolean): Promise<void> {
  const folderDocRef = doc(db, `folders/${userId}/userFolders`, folderId)
  await setDoc(folderDocRef, { starred, updatedAt: new Date() }, { merge: true })
}

export async function renameFolder(userId: string, folderId: string, newName: string): Promise<void> {
  const folderDocRef = doc(db, `folders/${userId}/userFolders`, folderId)
  await setDoc(folderDocRef, { name: newName, displayName: newName, updatedAt: new Date() }, { merge: true })

  // Log activity
  await addActivityLog(userId, "rename", newName, "folder", `Renamed folder to ${newName}`)
}
