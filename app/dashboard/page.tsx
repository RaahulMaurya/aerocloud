"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { DashboardNav } from "@/components/dashboard/dashboard-nav"
import { Sidebar } from "@/components/dashboard/sidebar"
import { StorageOverview } from "@/components/dashboard/storage-overview"
import { FilesList } from "@/components/dashboard/files-list"
import { StarredFiles } from "@/components/dashboard/starred-files"
import { ActivityLog } from "@/components/dashboard/activity-log"
import { SettingsPanel } from "@/components/dashboard/settings-panel"
import { FileUpload } from "@/components/dashboard/file-upload"
import { SharedLinksPanel } from "@/components/dashboard/shared-links-panel"


import { AIChatbotDialog } from "@/components/dashboard/ai-chatbot-dialog"
import { PlansDisplay } from "@/components/dashboard/plans-display"
import { StorageFullModal } from "@/components/storage-full-modal"

import { useAuth } from "@/contexts/auth-context"
import { LayoutGrid, FileText, LinkIcon, Activity, Settings, UploadIcon, Star, Crown } from "lucide-react"
import { doc, setDoc } from "firebase/firestore"
import { db } from "@/firebase/config"

export default function Dashboard() {
  const router = useRouter()
  const { user, userData, loading } = useAuth()
  const [activeTab, setActiveTab] = useState("overview")
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [showStorageFullModal, setShowStorageFullModal] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth")
    }
  }, [user, loading, router])

  useEffect(() => {
    if (userData) {
      const storageUsed = userData.storageUsed || 0
      const maxStorage = userData.maxStorage || 5368709120 // 5GB in bytes
      const storagePercent = (storageUsed / maxStorage) * 100

      const thresholds = [50, 60, 70, 80, 90, 95]
      const lastNotificationLevel = userData.lastNotificationLevel || 0

      for (const threshold of thresholds) {
        if (storagePercent >= threshold && lastNotificationLevel < threshold) {
          setShowStorageFullModal(true)
          // Update last notification level
          const userDocRef = doc(db, "users", userData.uid)
          setDoc(userDocRef, { lastNotificationLevel: threshold }, { merge: true })
          break
        }
      }
    }
  }, [userData])

  if (loading || !userData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-foreground/70">Loading your dashboard...</p>
        </div>
      </div>
    )
  }

  const storageTotalGB = userData.storageTotal || (userData.maxStorage ? userData.maxStorage / (1024 * 1024 * 1024) : 5)
  const plan = userData.plan || userData.subscriptionPlan || "free"
  const isFileToURLAllowed = plan !== "free"
  const isChatbotAllowed = plan === "pro" || plan === "enterprise"



  const handleNavigate = (section: string) => {
    setActiveTab(section)
  }

  return (
    <>
      <div className="h-screen bg-background flex flex-col overflow-hidden">
        <DashboardNav user={userData} onNavigate={handleNavigate} onChatOpen={() => setIsChatOpen(true)} />

        <div className="flex-1 flex overflow-hidden">
          <Sidebar
            activeTab={activeTab}
            onNavigate={handleNavigate}
            isFileToURLAllowed={isFileToURLAllowed}
            isChatbotAllowed={isChatbotAllowed}
          />

          <div className="flex-1 overflow-y-auto">
            <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full">
              {activeTab === "overview" && (
                <div className="space-y-8">
                  <div>
                    <h1 className="text-4xl font-bold text-foreground">Welcome back, {userData.displayName}!</h1>
                    <p className="text-foreground/60 mt-2">Here's what's happening with your cloud storage</p>
                  </div>
                  <StorageOverview user={userData} />
                  <div>
                    <h2 className="text-xl font-bold text-foreground mb-4">Recent Activity</h2>
                    <div className="max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent pr-1">
                      <ActivityLog />
                    </div>
                  </div>
                </div>

              )}

              {activeTab === "upload" && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-3xl font-bold text-foreground">Upload Files</h1>
                    <p className="text-foreground/60 mt-2">Add files to your cloud storage</p>
                  </div>
                  <FileUpload onUploadComplete={() => setRefreshTrigger((prev) => prev + 1)} />
                </div>
              )}

              {activeTab === "files" && <FilesList key={refreshTrigger} />}

              {activeTab === "starred" && <StarredFiles />}




              {activeTab === "shared-links" && (
                <div className="space-y-6">
                  <SharedLinksPanel />
                </div>
              )}

              {activeTab === "plans" && <PlansDisplay />}

              {activeTab === "activity" && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-3xl font-bold text-foreground">Activity Log</h1>
                    <p className="text-foreground/60 mt-2">Track all your account activities</p>
                  </div>
                  <ActivityLog full />
                </div>
              )}

              {activeTab === "settings" && <SettingsPanel user={userData} onNavigate={handleNavigate} />}
            </div>
          </div>
        </div>
      </div >

      {showStorageFullModal && (
        <StorageFullModal
          onUpgrade={() => {
            setShowStorageFullModal(false)
            setActiveTab("settings")
          }}
          onManageFiles={() => {
            setShowStorageFullModal(false)
            setActiveTab("files")
          }}
          onClose={() => setShowStorageFullModal(false)}
        />
      )
      }

      <AIChatbotDialog isOpen={isChatOpen} onOpen={() => setIsChatOpen(true)} onClose={() => setIsChatOpen(false)} />


    </>
  )
}
