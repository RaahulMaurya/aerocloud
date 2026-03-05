"use client"

import type React from "react"

import { Cloud, Settings, Menu, X, LogOut, Upload, FolderPlus, Star, Activity, Link2, Moon, Sun, HelpCircle, MessageCircle } from "lucide-react"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { useTheme } from "next-themes"

interface DashboardNavProps {
  user: {
    displayName: string
    email: string
  }
  onNavigate?: (section: string) => void
  onSearch?: (query: string) => void
  onChatOpen?: () => void
}

export function DashboardNav({ user, onNavigate, onSearch, onChatOpen }: DashboardNavProps) {
  const router = useRouter()
  const { logOut, userData, updateTheme } = useAuth()
  const { theme, setTheme } = useTheme()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [mounted, setMounted] = useState(false)
  const isPremium = (userData?.plan as string) === "premium" || (userData?.subscriptionPlan as string) === "premium"

  // Check plan features
  const plan = userData?.plan || userData?.subscriptionPlan || "free"
  const hasChatbot = plan === "pro" || plan === "enterprise"


  useEffect(() => {
    setMounted(true)
  }, [])

  const handleLogout = async () => {
    try {
      await logOut()
      router.push("/")
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim() && onSearch) {
      onSearch(searchQuery)
    }
  }

  const handleThemeToggle = async () => {
    const newTheme = theme === "dark" ? "light" : "dark"
    console.log("Theme toggle clicked, changing to:", newTheme)
    setTheme(newTheme)
    await updateTheme(newTheme)
  }

  return (
    <nav className="bg-gradient-to-r from-card via-card to-muted/20 border-b border-border/50 sticky top-0 z-40 backdrop-blur-md">
      <div className="px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => router.push("/dashboard")}>

              <span className="text-4xl font-extrabold text-foreground hidden md:inline font-[family-name:var(--font-comfortaa)] lowercase tracking-tight">
                aerocloud
              </span>
            </div>


          </div>

          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={() => onNavigate?.("upload")}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary via-primary to-accent text-white rounded-xl font-medium hover:shadow-xl hover:scale-105 transition-all duration-200 active:scale-95"
            >
              <Upload size={18} />
              <span>Upload</span>
            </button>
            <button
              onClick={() => onNavigate?.("files")}
              className="flex items-center gap-2 px-5 py-2.5 bg-background hover:bg-muted text-foreground rounded-xl font-medium border border-border/50 hover:border-primary/50 transition-all hover:shadow-md"
            >
              <FolderPlus size={18} />
              <span>New Folder</span>
            </button>

          </div>

          <div className="flex items-center gap-3">










            <button
              onClick={() => router.push("/support")}
              className="p-2.5 hover:bg-muted rounded-lg transition hover:scale-110 border border-transparent hover:border-border/50"
              title="Support"
            >
              <HelpCircle size={20} className="text-foreground/70 hover:text-primary transition" />
            </button>

            <button
              onClick={() => onNavigate?.("settings")}
              className="hidden sm:flex p-2.5 hover:bg-muted rounded-lg transition hover:scale-110"
            >
              <Settings size={20} className="text-foreground/70 hover:text-primary transition" />
            </button>

            {mounted && (





              <button
                onClick={handleThemeToggle}
                className="p-2.5 hover:bg-muted rounded-lg transition hover:scale-110 border border-transparent hover:border-border/50"
                title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              >
                {theme === "dark" ? (
                  <Sun size={20} className="text-foreground/70 hover:text-primary transition" />
                ) : (
                  <Moon size={20} className="text-foreground/70 hover:text-primary transition" />
                )}
              </button>


            )}

            <div className="hidden sm:flex items-center gap-3 pl-3 border-l border-border/50">
              <div className="w-9 h-9 bg-gradient-to-br from-primary to-accent rounded-full flex items-center justify-center shadow-md">
                <span className="text-xs font-bold text-primary-foreground">
                  {user.displayName.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{user.displayName}</p>
                <p className="text-xs text-foreground/60 truncate">{user.email}</p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="hidden sm:flex p-2.5 hover:bg-destructive/10 text-destructive rounded-lg transition hover:scale-110"
              title="Logout"
            >
              <LogOut size={20} />
            </button>

            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="sm:hidden p-2.5">
              {mobileMenuOpen ? (
                <X size={24} className="text-foreground" />
              ) : (
                <Menu size={24} className="text-foreground" />
              )}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="sm:hidden mt-4 pt-4 border-t border-border space-y-2">
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 bg-gradient-to-br from-primary to-accent rounded-full flex items-center justify-center">
                <span className="text-sm font-bold text-primary-foreground">
                  {user.displayName.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{user.displayName}</p>
                <p className="text-xs text-foreground/60">{user.email}</p>
              </div>
            </div>
            <button
              onClick={() => {
                onNavigate?.("upload")
                setMobileMenuOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-foreground/70 hover:bg-muted rounded-lg"
            >
              <Upload size={18} />
              Upload Files
            </button>
            <button
              onClick={() => {
                onNavigate?.("files")
                setMobileMenuOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-foreground/70 hover:bg-muted rounded-lg"
            >
              <FolderPlus size={18} />
              New Folder
            </button>
            <button
              onClick={() => {
                onNavigate?.("starred")
                setMobileMenuOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-foreground/70 hover:bg-muted rounded-lg"
            >
              <Star size={18} />
              Starred Files
            </button>
            <button
              onClick={() => {
                onNavigate?.("shared")
                setMobileMenuOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-foreground/70 hover:bg-muted rounded-lg"
            >
              <Link2 size={18} />
              Shared Links
            </button>
            <button
              onClick={() => {
                onNavigate?.("activity")
                setMobileMenuOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-foreground/70 hover:bg-muted rounded-lg"
            >
              <Activity size={18} />
              Activity Log
            </button>
            {isPremium && (
              <button
                onClick={onChatOpen}
                className="w-full flex items-center gap-2 px-3 py-2 text-foreground/70 hover:bg-muted rounded-lg"
              >
                <MessageCircle size={18} />
                AI Assistant
              </button>
            )}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 text-destructive hover:bg-destructive/10 rounded-lg"
            >
              <LogOut size={18} />
              Logout
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
