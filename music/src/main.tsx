import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { CartProvider } from './cart'
import { LangProvider, useI18n } from './i18n'
import { Center, Footer, Header } from './components/ui'
import CheckoutSheet from './components/CheckoutSheet'
import CataloguePage from './pages/Catalogue'
import PiecePage from './pages/Piece'
import ThanksPage from './pages/Thanks'
import LegalPage from './pages/Legal'
import './styles.css'

function NotFound() {
  const { t } = useI18n()
  return <Center><p>{t.notFound}</p><Link to="/">{t.backHome}</Link></Center>
}

function Shell() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
    if (pathname === '/') document.title = 'Ghost Hands Sheets — sheet music from the Reels'
  }, [pathname])
  return (
    <div className={pathname.startsWith('/s/') ? 'has-buybar' : ''}>
      <Header />
      <Routes>
        <Route path="/" element={<CataloguePage />} />
        <Route path="/s/:slug" element={<PiecePage />} />
        <Route path="/thanks" element={<ThanksPage />} />
        <Route path="/legal/:doc" element={<LegalPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
      <CheckoutSheet />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <CartProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </CartProvider>
    </LangProvider>
  </StrictMode>,
)
