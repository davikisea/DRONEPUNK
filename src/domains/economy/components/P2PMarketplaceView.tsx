/**
 * ==============================================================================
 * VISTA DEL MERCADO LIBRE P2P GLOBAL ENTRE JUGADORES
 * ==============================================================================
 * Estilo visual: Skill retro-futurism (Atompunk, esquinas asimétricas, biseles metálicos,
 * sombras duras y paleta canónica #46521F, #7B8A4A, #C46A3A, #F2E8D5, #2B2C24).
 * Implementa la Tasa Municipal del 12% a quema y bandas de precio ±35% del PMM.
 */

import React, { useState } from 'react';
import {
  ShoppingBag,
  Coins,
  ArrowRight,
  Filter,
  PlusCircle,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  Scale,
  Flame,
  X,
  Hammer,
  Boxes,
  Cpu,
  UserCheck
} from 'lucide-react';
import {
  IndustrialEngine,
  IndustrialInventory,
  RefinedResourceType,
  P2PMarketListing,
  P2PPriceReference
} from '@domains/economy';
import { audioManager } from '@domains/game-feel';
import { supabase } from '@shared';
import { MASTER_METAGAME_CONSTANTS } from '@shared';

interface P2PMarketplaceViewProps {
  currentUserId: string;
  currentUserName: string;
  userGold: number;
  onUpdateUserGold: (newGold: number) => void;
  inventory: IndustrialInventory;
  onUpdateInventory: (updated: IndustrialInventory) => void;
  onNavigateToIndustry?: () => void;
}

export const P2PMarketplaceView: React.FC<P2PMarketplaceViewProps> = ({
  currentUserId,
  currentUserName,
  userGold,
  onUpdateUserGold,
  inventory,
  onUpdateInventory,
  onNavigateToIndustry,
}) => {
  // Precios de referencia de mercado canónicos (PMM con bandas VWAP Collar ±25%)
  const [priceReferences, setPriceReferences] = useState<Record<string, P2PPriceReference>>({
    refined_steel: {
      resourceType: 'refined_steel',
      movingAveragePriceGold: 50,
      collarMinPriceGold: 37, // -25%
      collarMaxPriceGold: 63, // +25%
      volume24h: 1420,
    },
    refined_concrete: {
      resourceType: 'refined_concrete',
      movingAveragePriceGold: 30,
      collarMinPriceGold: 22, // -25%
      collarMaxPriceGold: 38, // +25%
      volume24h: 2150,
    },
    refined_microchip: {
      resourceType: 'refined_microchip',
      movingAveragePriceGold: 120,
      collarMinPriceGold: 90, // -25%
      collarMaxPriceGold: 150, // +25%
      volume24h: 680,
    },
  });

  // Lista activa de órdenes en el mercado con canon del 2% (1% sink + 1% regalía)
  const [listings, setListings] = useState<P2PMarketListing[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoadingPage, setIsLoadingPage] = useState<boolean>(false);
  const [totalActiveCount, setTotalActiveCount] = useState<number>(0);

  // Filtros y Pestañas (declarados antes de la suscripción para acotar RPC/Broadcast)
  const [resourceFilter, setResourceFilter] = useState<'all' | RefinedResourceType>('all');
  const [viewTab, setViewTab] = useState<'market' | 'my_listings'>('market');
  const activeCategory = 'refined_material';

  const cursorRef = React.useRef<{ createdAt: string; id: string } | null>(null);
  const pendingDeltasRef = React.useRef<Map<string, { op: string; record: any; seq: number }>>(new Map());
  const lastSeqByOrderRef = React.useRef<Map<string, number>>(new Map());
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cachedUserIdRef = React.useRef<string | null>(
    currentUserId && currentUserId !== 'user_me' ? currentUserId : null
  );

  React.useEffect(() => {
    if (currentUserId && currentUserId !== 'user_me') {
      cachedUserIdRef.current = currentUserId;
    }
  }, [currentUserId]);

  const mapOrderRowToListing = React.useCallback((o: any): P2PMarketListing => ({
    id: o.id,
    sellerId: o.seller_id,
    sellerName: o.seller_id === currentUserId ? currentUserName : `Comandante ${String(o.seller_id || '').slice(0, 8)}`,
    resourceType: (o.item_code as RefinedResourceType) || 'refined_steel',
    quantity: o.quantity,
    pricePerUnitGold: o.unit_price_ec,
    totalPriceGold: o.total_price_ec,
    taxDeductedGold: (o.platform_burn_ec || 0) + (o.province_royalty_ec || 0),
    netSellerRevenueGold: o.net_seller_revenue_ec,
    status: o.status as any,
    createdAt: new Date(o.created_at).getTime(),
  }), [currentUserId, currentUserName]);

  const PAGE_SIZE = 50;
  const isUuid = (val: string | null | undefined): val is string =>
    Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val));

  // Paginación keyset O(log N) vía RPC get_p2p_market_orders_page
  const fetchOrders = React.useCallback(async (reset: boolean = true) => {
    if (reset) {
      cursorRef.current = null;
    }
    setIsLoadingPage(true);
    try {
      const sellerParam =
        viewTab === 'my_listings' && isUuid(currentUserId) ? currentUserId : null;
      const itemCodeParam =
        viewTab === 'market' && resourceFilter !== 'all' ? resourceFilter : null;

      const { data, error } = await supabase.rpc('get_p2p_market_orders_page', {
        p_item_category: activeCategory,
        p_item_code: itemCodeParam,
        p_seller_id: sellerParam,
        p_status: 'active',
        p_cursor_created_at: reset ? null : (cursorRef.current?.createdAt ?? null),
        p_cursor_id: reset ? null : (cursorRef.current?.id ?? null),
        p_limit: PAGE_SIZE,
      });

      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      const liveListings: P2PMarketListing[] = rows.map(mapOrderRowToListing);

      if (rows.length > 0) {
        const last = rows[rows.length - 1];
        cursorRef.current = { createdAt: last.created_at, id: last.id };
        setTotalActiveCount(Number(rows[0]?.total_active_count ?? rows.length));
      } else if (reset) {
        setTotalActiveCount(0);
      }

      setHasMore(rows.length === PAGE_SIZE);

      if (reset) {
        setListings(liveListings);
      } else {
        setListings((prev) => {
          const existingIds = new Set(prev.map((item) => item.id));
          const merged = [...prev];
          for (const item of liveListings) {
            if (!existingIds.has(item.id)) {
              merged.push(item);
            }
          }
          return merged;
        });
      }
    } catch (err) {
      console.error('[P2PMarketplaceView] Error consultando órdenes paginadas RPC:', err);
    } finally {
      setIsLoadingPage(false);
    }
  }, [activeCategory, currentUserId, mapOrderRowToListing, resourceFilter, viewTab]);

  // Flush debounced de deltas Broadcast v3 en memoria
  const flushPendingDeltas = React.useCallback(() => {
    if (pendingDeltasRef.current.size === 0) return;
    const batch = Array.from(pendingDeltasRef.current.values());
    pendingDeltasRef.current.clear();

    setListings((prev) => {
      const next = [...prev];
      const indexById = new Map<string, number>();
      next.forEach((item, idx) => indexById.set(item.id, idx));

      for (const delta of batch) {
        const rec = delta.record;
        if (!rec || !rec.id) continue;

        const prevSeq = lastSeqByOrderRef.current.get(rec.id) ?? 0;
        if (delta.seq > 0 && delta.seq < prevSeq) continue;
        if (delta.seq > 0) lastSeqByOrderRef.current.set(rec.id, delta.seq);

        const isDeletedOrInactive = delta.op === 'DELETE' || rec.status !== 'active';
        const existingIdx = indexById.get(rec.id);

        if (isDeletedOrInactive) {
          if (existingIdx !== undefined) {
            next.splice(existingIdx, 1);
            indexById.clear();
            next.forEach((item, idx) => indexById.set(item.id, idx));
          }
        } else {
          const mapped = mapOrderRowToListing(rec);
          if (existingIdx !== undefined) {
            next[existingIdx] = mapped;
          } else {
            next.unshift(mapped);
            indexById.clear();
            next.forEach((item, idx) => indexById.set(item.id, idx));
          }
        }
      }
      return next;
    });
  }, [mapOrderRowToListing]);

  React.useEffect(() => {
    fetchOrders(true);
  }, [fetchOrders]);

  // Canal Broadcast acotado por categoría: market:p2p:{category}
  React.useEffect(() => {
    const channelName = `market:p2p:${activeCategory}`;
    const channel = supabase
      .channel(channelName, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'MARKET_ORDER' }, ({ payload }: { payload: any }) => {
        if (!payload || !payload.record?.id) return;
        if (payload.table && payload.table !== 'p2p_market_orders') return;

        const orderId = String(payload.record.id);
        const seq = Number(payload.seq ?? 0);
        const queued = pendingDeltasRef.current.get(orderId);
        if (!queued || seq >= queued.seq) {
          pendingDeltasRef.current.set(orderId, {
            op: String(payload.op || 'UPDATE'),
            record: payload.record,
            seq,
          });
        }

        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          flushPendingDeltas();
        }, 120);
      })
      .subscribe();

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      pendingDeltasRef.current.clear();
      supabase.removeChannel(channel);
    };
  }, [activeCategory, flushPendingDeltas]);

  // Modales y alertas
  const [isPublishModalOpen, setIsPublishModalOpen] = useState<boolean>(false);
  const [feedbackAlert, setFeedbackAlert] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Formulario de Publicación
  const [publishResource, setPublishResource] = useState<RefinedResourceType>('refined_steel');
  const [publishQuantity, setPublishQuantity] = useState<number>(10);
  const [publishPricePerUnit, setPublishPricePerUnit] = useState<number>(50);

  const activeRef = priceReferences[publishResource];
  const activeCollars = {
    minPrice: Math.floor(activeRef.movingAveragePriceGold * (1 - MASTER_METAGAME_CONSTANTS.P2P_COLLAR_MAX_DEVIATION)),
    maxPrice: Math.ceil(activeRef.movingAveragePriceGold * (1 + MASTER_METAGAME_CONSTANTS.P2P_COLLAR_MAX_DEVIATION)),
  };

  const showFeedback = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedbackAlert({ text, type });
    setTimeout(() => setFeedbackAlert(null), 3500);
  };

  // Acción: Publicar Orden en el Mercado con Split del 2%
  const handlePublishListing = async () => {
    if (publishQuantity <= 0) {
      showFeedback('La cantidad debe ser mayor a 0.', 'error');
      return;
    }

    if (publishPricePerUnit < activeCollars.minPrice || publishPricePerUnit > activeCollars.maxPrice) {
      showFeedback(
        `Precio fuera de banda. Rango: ${activeCollars.minPrice}G a ${activeCollars.maxPrice}G (±25% VWAP Collar).`,
        'error'
      );
      return;
    }

    let available = 0;
    if (publishResource === 'refined_steel') available = inventory.refinedSteel;
    else if (publishResource === 'refined_concrete') available = inventory.refinedConcrete;
    else if (publishResource === 'refined_microchip') available = inventory.refinedMicrochip;

    if (available < publishQuantity) {
      showFeedback('Inventario insuficiente para publicar la venta.', 'error');
      return;
    }

    const totalPriceGold = publishQuantity * publishPricePerUnit;
    const taxTotal = Math.round(totalPriceGold * MASTER_METAGAME_CONSTANTS.P2P_MARKET_FEE_RATE); // 2%
    const taxBurn = Math.floor(taxTotal * MASTER_METAGAME_CONSTANTS.P2P_FEE_BURN_SHARE); // 1%
    const taxRoyalty = taxTotal - taxBurn; // 1%
    const netSellerRevenueGold = totalPriceGold - taxTotal;

    try {
      let activeSellerId = cachedUserIdRef.current;
      if (!activeSellerId) {
        const { data: sessionData } = await supabase.auth.getSession();
        activeSellerId = sessionData?.session?.user?.id ?? null;
        if (activeSellerId) {
          cachedUserIdRef.current = activeSellerId;
        }
      }

      if (!activeSellerId || activeSellerId === 'user_me') {
        showFeedback('Debe tener una sesión militar activa para publicar en el mercado P2P.', 'error');
        return;
      }

      const { data: insertedOrder, error: insertError } = await supabase.rpc(
        'publish_p2p_market_order',
        {
          p_item_category: activeCategory,
          p_item_code: publishResource,
          p_tier: 1,
          p_quantity: publishQuantity,
          p_unit_price_ec: publishPricePerUnit,
          p_origin_province_id: 'ES_MADRID',
          p_province_terminal_id: 'ES_MADRID',
          p_idempotency_key: crypto.randomUUID(),
        }
      );

      if (insertError) {
        showFeedback(`Error en base de datos: ${insertError.message}`, 'error');
        return;
      }

      // Descontar inventario local solo tras confirmación de base de datos
      const updatedInv: IndustrialInventory = {
        ...inventory,
        refinedSteel:
          publishResource === 'refined_steel'
            ? inventory.refinedSteel - publishQuantity
            : inventory.refinedSteel,
        refinedConcrete:
          publishResource === 'refined_concrete'
            ? inventory.refinedConcrete - publishQuantity
            : inventory.refinedConcrete,
        refinedMicrochip:
          publishResource === 'refined_microchip'
            ? inventory.refinedMicrochip - publishQuantity
            : inventory.refinedMicrochip,
      };

      onUpdateInventory(updatedInv);

      if (insertedOrder) {
        const newListing: P2PMarketListing = {
          id: insertedOrder.id,
          sellerId: insertedOrder.seller_id,
          sellerName: currentUserName,
          resourceType: publishResource,
          quantity: publishQuantity,
          pricePerUnitGold: publishPricePerUnit,
          totalPriceGold,
          taxDeductedGold: taxTotal,
          netSellerRevenueGold,
          status: 'active',
          createdAt: new Date(insertedOrder.created_at).getTime(),
        };
        setListings((prev) =>
          prev.some((l) => l.id === newListing.id) ? prev : [newListing, ...prev]
        );
      }

      setIsPublishModalOpen(false);
      audioManager.playSFX('button_click');
      showFeedback(
        `¡Orden publicada en Supabase! ${publishQuantity} unidades en venta a ${publishPricePerUnit}G/u (Canon 2%: 1% sink + 1% regalía).`
      );
    } catch (err: any) {
      console.error('[P2PMarketplaceView] Error en publicación:', err);
      showFeedback(err.message || 'Error de red al publicar orden', 'error');
    }
  };

  // Acción: Cancelar Venta Propia vía RPC atómica cancel_p2p_market_order
  const handleCancelListing = async (listingId: string) => {
    const target = listings.find((l) => l.id === listingId);
    if (!target || target.status !== 'active') return;

    try {
      const { data: cancelRes, error: cancelError } = await supabase.rpc(
        'cancel_p2p_market_order',
        {
          p_order_id: listingId,
          p_idempotency_key: crypto.randomUUID(),
        }
      );

      if (cancelError) {
        showFeedback(`Fallo al cancelar orden: ${cancelError.message}`, 'error');
        return;
      }

      const res = cancelRes as { success?: boolean; error?: string } | null;
      if (res && res.success === false) {
        showFeedback(`Fallo al cancelar orden: ${res.error || 'Error desconocido'}`, 'error');
        return;
      }

      // Devolver recursos al inventario tras cancelación confirmada en DB
      const updatedInv: IndustrialInventory = {
        ...inventory,
        refinedSteel:
          target.resourceType === 'refined_steel'
            ? inventory.refinedSteel + target.quantity
            : inventory.refinedSteel,
        refinedConcrete:
          target.resourceType === 'refined_concrete'
            ? inventory.refinedConcrete + target.quantity
            : inventory.refinedConcrete,
        refinedMicrochip:
          target.resourceType === 'refined_microchip'
            ? inventory.refinedMicrochip + target.quantity
            : inventory.refinedMicrochip,
      };

      onUpdateInventory(updatedInv);
      setListings((prev) => prev.filter((l) => l.id !== listingId));
      audioManager.playSFX('button_click');
      showFeedback(`Orden cancelada. Los materiales han regresado a tu inventario.`);
    } catch (err: any) {
      showFeedback('Error al cancelar orden en servidor', 'error');
    }
  };

  // Acción: Comprar Orden P2P vía RPC execute_p2p_market_transaction
  const handleBuyListing = async (listing: P2PMarketListing) => {
    if (listing.status !== 'active') {
      showFeedback('La orden ya no está disponible.', 'error');
      return;
    }
    if (listing.sellerId === currentUserId) {
      showFeedback('No puedes comprar tu propia orden.', 'error');
      return;
    }
    if (userGold < listing.totalPriceGold) {
      showFeedback(
        `Fondos insuficientes. Requiere ${listing.totalPriceGold}G (Posees ${userGold}G).`,
        'error'
      );
      return;
    }

    try {
      const { data: rpcRes, error: rpcError } = await supabase.rpc(
        'execute_p2p_market_transaction',
        {
          p_order_id: listing.id,
        }
      );

      if (rpcError) {
        showFeedback(`Transacción rechazada por el servidor: ${rpcError.message}`, 'error');
        return;
      }

      const res = rpcRes as any;
      if (!res?.success) {
        showFeedback(`Transacción rechazada: ${res?.error || 'Error desconocido'}`, 'error');
        return;
      }

      // Actualizar saldos tras éxito confirmado por la RPC
      const updatedBuyerGold = userGold - listing.totalPriceGold;
      const updatedBuyerInv: IndustrialInventory = {
        ...inventory,
        refinedSteel:
          listing.resourceType === 'refined_steel'
            ? inventory.refinedSteel + listing.quantity
            : inventory.refinedSteel,
        refinedConcrete:
          listing.resourceType === 'refined_concrete'
            ? inventory.refinedConcrete + listing.quantity
            : inventory.refinedConcrete,
        refinedMicrochip:
          listing.resourceType === 'refined_microchip'
            ? inventory.refinedMicrochip + listing.quantity
            : inventory.refinedMicrochip,
      };

      onUpdateUserGold(updatedBuyerGold);
      onUpdateInventory(updatedBuyerInv);
      setListings((prev) => prev.filter((l) => l.id !== listing.id));

      audioManager.playSFX('victory');
      const taxBurn = Math.floor(listing.taxDeductedGold * 0.5);
      const taxRoyalty = listing.taxDeductedGold - taxBurn;
      showFeedback(
        `¡Compra completada con éxito! -${listing.totalPriceGold}G. Canon 2%: ${taxBurn}G quemados + ${taxRoyalty}G a la provincia soberana.`
      );
    } catch (err: any) {
      console.error('[P2PMarketplaceView] RPC error:', err);
      showFeedback(`Fallo de conexión en transacción P2P: ${err.message}`, 'error');
    }
  };

  // Acción: Barrido de Liquidez por Intendencia Militar (NPC Market Maker)
  const handleTriggerNPCMaker = () => {
    const sweepResult = IndustrialEngine.fulfillStaleP2POrders(listings, Date.now());
    if (sweepResult.fulfilledCount > 0) {
      setListings(sweepResult.updatedListings);
      audioManager.playSFX('victory');
      showFeedback(
        `¡Intendencia Militar del Estado Mayor absorbió ${sweepResult.fulfilledCount} órdenes estancadas (+${sweepResult.totalCreditsDisbursed}G liquidados a vendedores)!`
      );
    } else {
      audioManager.playSFX('button_click');
      showFeedback('No hay órdenes estancadas (>6h) que requieran absorción por la Intendencia.');
    }
  };

  const filteredListings = listings.filter(l => {
    if (viewTab === 'my_listings') {
      return l.sellerId === currentUserId;
    }
    if (l.status !== 'active') return false;
    if (resourceFilter !== 'all' && l.resourceType !== resourceFilter) return false;
    return true;
  });

  return (
    <div className="flex-1 flex flex-col bg-[#2B2C24] text-[#F2E8D5] font-mono p-4 sm:p-6 overflow-y-auto select-none">
      {/* Cabecera Atompunk del Mercado Libre P2P */}
      <div className="bg-[#46521F] border-2 border-[#2B2C24] rounded-[24px_6px_24px_6px] p-4 shadow-[6px_6px_0px_#2B2C24] mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-[8px_2px_8px_2px] bg-[#C46A3A] text-[#F2E8D5] font-black text-xs uppercase tracking-wider border border-[#2B2C24]">
              FASE 5 CALIBRADA
            </span>
            <h1 className="text-lg font-black tracking-wide text-[#F2E8D5] flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-[#C46A3A]" />
              MERCADO LIBRE P2P (GLOBAL ORDER BOOK)
            </h1>
          </div>
          <p className="text-xs text-[#F2E8D5]/80 mt-1">
            Comercio P2P Soberano: Canon del 2% (1% Quema Permanente + 1% Regalía Provincial), Bandas VWAP Collar (±25%) y Garantía de Liquidez.
          </p>
        </div>

        {/* Saldo de Oro del Jugador y Botón de Publicar */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#2B2C24] px-3 py-1.5 rounded-[12px_3px_12px_3px] border border-[#7B8A4A]">
            <Coins className="w-4 h-4 text-amber-300" />
            <span className="text-xs text-[#F2E8D5]">Oro Disponible:</span>
            <strong className="text-amber-300 font-bold">{userGold}G</strong>
          </div>

          <button
            onClick={() => setIsPublishModalOpen(true)}
            className="px-4 py-2 bg-[#C46A3A] hover:bg-[#b05c2e] text-[#F2E8D5] font-black text-xs uppercase tracking-wider rounded-[14px_4px_14px_4px] border-2 border-[#2B2C24] shadow-[4px_4px_0px_#2B2C24] flex items-center gap-1.5 cursor-pointer transition-all"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Publicar Venta</span>
          </button>
        </div>
      </div>

      {/* Banner de Garantía de Liquidez: Banco Central de Intendencia Militar (NPC) */}
      <div className="bg-[#2B2C24] border-2 border-[#7B8A4A] rounded-[16px_4px_16px_4px] p-3 mb-4 flex flex-wrap items-center justify-between gap-3 text-xs shadow-[3px_3px_0px_#2B2C24]">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#7B8A4A] shrink-0" />
          <div>
            <strong className="text-white">GARANTÍA DE LIQUIDEZ PERPETUA:</strong>{' '}
            <span className="text-[#F2E8D5]/80">
              El Banco Central de Intendencia Militar del Estado Mayor absorbe automáticamente órdenes &gt;6h en precio de banda.
            </span>
          </div>
        </div>
        <button
          onClick={handleTriggerNPCMaker}
          className="px-3 py-1 bg-[#46521F] hover:bg-[#3d481b] text-white font-bold text-[11px] rounded border border-[#7B8A4A] cursor-pointer"
        >
          Ejecutar Barrido NPC
        </button>
      </div>

      {/* Alerta de Feedback Temporal */}
      {feedbackAlert && (
        <div
          className={`p-3 rounded-[12px_3px_12px_3px] border-2 mb-4 text-xs font-bold flex items-center justify-between shadow-[4px_4px_0px_#2B2C24] animate-in fade-in duration-150 ${
            feedbackAlert.type === 'success'
              ? 'bg-[#46521F] border-[#7B8A4A] text-[#F2E8D5]'
              : 'bg-red-950 border-red-500 text-red-200'
          }`}
        >
          <span>{feedbackAlert.text}</span>
          <button onClick={() => setFeedbackAlert(null)} className="hover:opacity-75 cursor-pointer">✕</button>
        </div>
      )}

      {/* Bandas de Precio Promedio Móvil de Mercado (PMM) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {Object.values(priceReferences).map(ref => (
          <div
            key={ref.resourceType}
            className="bg-[#46521F] border-2 border-[#2B2C24] rounded-[16px_4px_16px_4px] p-3 shadow-[3px_3px_0px_#2B2C24] text-xs flex justify-between items-center"
          >
            <div>
              <div className="font-bold text-[#F2E8D5] flex items-center gap-1">
                {ref.resourceType === 'refined_steel' && <Hammer className="w-3.5 h-3.5 text-slate-300" />}
                {ref.resourceType === 'refined_concrete' && <Boxes className="w-3.5 h-3.5 text-stone-300" />}
                {ref.resourceType === 'refined_microchip' && <Cpu className="w-3.5 h-3.5 text-cyan-300" />}
                <span>
                  {ref.resourceType === 'refined_steel'
                    ? 'Acero Militar'
                    : ref.resourceType === 'refined_concrete'
                    ? 'Hormigón Armado'
                    : 'Microchips'}
                </span>
              </div>
              <div className="text-[10px] text-[#F2E8D5]/70 mt-0.5">
                Volumen 24h: {ref.volume24h} u.
              </div>
            </div>

            <div className="text-right">
              <span className="text-amber-300 font-black text-sm">{ref.movingAveragePriceGold}G/u</span>
              <div className="text-[10px] text-[#7B8A4A] font-bold">
                Banda: {ref.collarMinPriceGold}G - {ref.collarMaxPriceGold}G
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Barra de Filtros y Navegación del Tablón */}
      <div className="bg-[#46521F] border-2 border-[#2B2C24] rounded-[18px_4px_18px_4px] p-3 shadow-[4px_4px_0px_#2B2C24] mb-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Conmutador de Vistas */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewTab('market')}
            className={`px-3 py-1.5 rounded-[10px_3px_10px_3px] border font-bold transition-all cursor-pointer ${
              viewTab === 'market'
                ? 'bg-[#C46A3A] border-[#2B2C24] text-[#F2E8D5] shadow-[2px_2px_0px_#2B2C24]'
                : 'bg-[#2B2C24] border-[#7B8A4A] text-[#F2E8D5]/70'
            }`}
          >
            Libro de Órdenes Global
          </button>
          <button
            onClick={() => setViewTab('my_listings')}
            className={`px-3 py-1.5 rounded-[10px_3px_10px_3px] border font-bold transition-all cursor-pointer ${
              viewTab === 'my_listings'
                ? 'bg-[#C46A3A] border-[#2B2C24] text-[#F2E8D5] shadow-[2px_2px_0px_#2B2C24]'
                : 'bg-[#2B2C24] border-[#7B8A4A] text-[#F2E8D5]/70'
            }`}
          >
            Mis Publicaciones ({listings.filter(l => l.sellerId === currentUserId).length})
          </button>
        </div>

        {/* Filtro por Tipo de Recurso */}
        {viewTab === 'market' && (
          <div className="flex items-center gap-1.5">
            <span className="text-[#F2E8D5]/70 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-[#C46A3A]" /> Filtrar:
            </span>
            {(['all', 'refined_steel', 'refined_concrete', 'refined_microchip'] as const).map(res => (
              <button
                key={res}
                onClick={() => setResourceFilter(res)}
                className={`px-2.5 py-1 rounded-[8px_2px_8px_2px] border text-[11px] font-bold transition-all cursor-pointer ${
                  resourceFilter === res
                    ? 'bg-[#7B8A4A] border-[#2B2C24] text-[#F2E8D5] shadow-[2px_2px_0px_#2B2C24]'
                    : 'bg-[#2B2C24] border-[#7B8A4A]/50 text-[#F2E8D5]/70'
                }`}
              >
                {res === 'all'
                  ? 'Todos'
                  : res === 'refined_steel'
                  ? 'Acero'
                  : res === 'refined_concrete'
                  ? 'Hormigón'
                  : 'Chips'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tablón Principal de Órdenes */}
      <div className="bg-[#46521F] border-2 border-[#2B2C24] rounded-[18px_4px_18px_4px] p-4 shadow-[4px_4px_0px_#2B2C24] overflow-hidden">
        {filteredListings.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#F2E8D5]/60 bg-[#2B2C24] rounded-[12px_3px_12px_3px] border border-[#7B8A4A]/50">
            {viewTab === 'my_listings'
              ? 'No tienes órdenes de venta publicadas actualmente.'
              : 'No hay ofertas disponibles para el filtro seleccionado.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[#7B8A4A] text-[#F2E8D5]/70 text-[11px] uppercase pb-2">
                  <th className="py-2 px-3">Recurso Militar</th>
                  <th className="py-2 px-3">Cantidad</th>
                  <th className="py-2 px-3">Precio / Unidad</th>
                  <th className="py-2 px-3">Total Bruto</th>
                  <th className="py-2 px-3">Vendedor</th>
                  <th className="py-2 px-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#7B8A4A]/30">
                {filteredListings.map(listing => {
                  const isOwn = listing.sellerId === currentUserId;
                  const canAfford = userGold >= listing.totalPriceGold;

                  return (
                    <tr key={listing.id} className="hover:bg-[#2B2C24]/40 transition-colors">
                      <td className="py-3 px-3 font-bold text-white flex items-center gap-2">
                        {listing.resourceType === 'refined_steel' && <Hammer className="w-4 h-4 text-slate-300" />}
                        {listing.resourceType === 'refined_concrete' && <Boxes className="w-4 h-4 text-stone-300" />}
                        {listing.resourceType === 'refined_microchip' && <Cpu className="w-4 h-4 text-cyan-300" />}
                        <span>
                          {listing.resourceType === 'refined_steel'
                            ? 'Vigas de Acero'
                            : listing.resourceType === 'refined_concrete'
                            ? 'Hormigón Armado'
                            : 'Microprocesadores'}
                        </span>
                      </td>

                      <td className="py-3 px-3 font-black text-sm text-[#F2E8D5]">
                        {listing.quantity} u.
                      </td>

                      <td className="py-3 px-3 text-amber-300 font-bold">
                        {listing.pricePerUnitGold}G / u
                      </td>

                      <td className="py-3 px-3 font-black text-white">
                        {listing.totalPriceGold}G
                      </td>

                      <td className="py-3 px-3 text-xs text-[#F2E8D5]/80">
                        {listing.sellerName} {isOwn && <span className="text-[#C46A3A] font-bold">(Tú)</span>}
                      </td>

                      <td className="py-3 px-3 text-right">
                        {isOwn ? (
                          listing.status === 'active' ? (
                            <button
                              onClick={() => handleCancelListing(listing.id)}
                              className="px-3 py-1 bg-red-900/80 hover:bg-red-800 text-red-100 font-bold text-[11px] rounded border border-red-700 cursor-pointer"
                            >
                              Cancelar
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-500 uppercase font-bold">{listing.status}</span>
                          )
                        ) : (
                          <button
                            onClick={() => handleBuyListing(listing)}
                            disabled={!canAfford}
                            className="px-3.5 py-1.5 bg-[#C46A3A] hover:bg-[#b05c2e] disabled:opacity-40 disabled:cursor-not-allowed text-[#F2E8D5] font-black text-xs rounded-[8px_2px_8px_2px] border border-[#2B2C24] shadow-[2px_2px_0px_#2B2C24] cursor-pointer transition-all"
                            title={canAfford ? 'Comprar lote' : 'Oro insuficiente'}
                          >
                            Comprar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {(hasMore || totalActiveCount > 0) && (
          <div className="mt-3 pt-3 border-t border-[#7B8A4A]/40 flex items-center justify-between text-[11px] text-[#F2E8D5]/75">
            <span>
              Mostrando {filteredListings.length}
              {totalActiveCount > 0 ? ` de ${totalActiveCount} órdenes activas` : ' órdenes'}
            </span>
            {hasMore && (
              <button
                onClick={() => fetchOrders(false)}
                disabled={isLoadingPage}
                className="px-3 py-1 bg-[#2B2C24] hover:bg-[#3a3b30] disabled:opacity-50 text-[#F2E8D5] font-bold rounded-[8px_2px_8px_2px] border border-[#7B8A4A] cursor-pointer transition-all"
              >
                {isLoadingPage ? 'Cargando...' : 'Cargar más órdenes'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* MODAL PARA PUBLICAR NUEVA VENTA */}
      {isPublishModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2B2C24]/85 backdrop-blur-md">
          <div className="relative w-full max-w-md bg-[#46521F] border-2 border-[#2B2C24] rounded-[24px_6px_24px_6px] p-5 shadow-[10px_10px_0px_#2B2C24] font-mono text-[#F2E8D5] flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#7B8A4A]">
              <h2 className="text-sm font-black uppercase tracking-wider text-[#F2E8D5] flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-[#C46A3A]" />
                Publicar Orden de Venta P2P
              </h2>
              <button
                onClick={() => setIsPublishModalOpen(false)}
                className="text-xs text-[#F2E8D5]/70 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Recurso a Vender */}
            <div>
              <label className="text-xs font-bold block mb-1">Recurso a Vender:</label>
              <select
                value={publishResource}
                onChange={e => {
                  const res = e.target.value as RefinedResourceType;
                  setPublishResource(res);
                  setPublishPricePerUnit(priceReferences[res].movingAveragePriceGold);
                }}
                className="w-full bg-[#2B2C24] border border-[#7B8A4A] text-[#F2E8D5] p-2 rounded text-xs focus:outline-none"
              >
                <option value="refined_steel">Vigas de Acero Militar (Posees: {inventory.refinedSteel})</option>
                <option value="refined_concrete">Hormigón Armado (Posees: {inventory.refinedConcrete})</option>
                <option value="refined_microchip">Microprocesadores de Guía (Posees: {inventory.refinedMicrochip})</option>
              </select>
            </div>

            {/* Cantidad */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-bold">Cantidad de Unidades:</span>
                <span className="text-[#F2E8D5]/70">
                  Disponibles:{' '}
                  {publishResource === 'refined_steel'
                    ? inventory.refinedSteel
                    : publishResource === 'refined_concrete'
                    ? inventory.refinedConcrete
                    : inventory.refinedMicrochip}
                </span>
              </div>
              <input
                type="number"
                min="1"
                max="500"
                value={publishQuantity}
                onChange={e => setPublishQuantity(Math.max(1, Number(e.target.value)))}
                className="w-full bg-[#2B2C24] border border-[#7B8A4A] text-[#F2E8D5] p-2 rounded text-xs focus:outline-none"
              />
            </div>

            {/* Precio Unitario y Bandas ±35% */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-bold">Precio por Unidad (Oro):</span>
                <span className="text-amber-300 font-bold">
                  Banda Permitida: {activeCollars.minPrice}G - {activeCollars.maxPrice}G
                </span>
              </div>
              <input
                type="number"
                min={activeCollars.minPrice}
                max={activeCollars.maxPrice}
                value={publishPricePerUnit}
                onChange={e => setPublishPricePerUnit(Number(e.target.value))}
                className="w-full bg-[#2B2C24] border border-[#7B8A4A] text-[#F2E8D5] p-2 rounded text-xs focus:outline-none"
              />
            </div>

            {/* Desglose de Liquidación con Tasa del 12% */}
            <div className="bg-[#2B2C24] p-3 rounded-[12px_3px_12px_3px] border border-[#7B8A4A] text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[#F2E8D5]/70">Ingreso Bruto de la Venta:</span>
                <strong className="text-white">{publishQuantity * publishPricePerUnit}G</strong>
              </div>
              <div className="flex justify-between text-amber-300">
                <span>Canon P2P (2% Split: 1% Sink + 1% Regalía):</span>
                <span>-{Math.round(publishQuantity * publishPricePerUnit * 0.02)}G</span>
              </div>
              <div className="flex justify-between text-[10px] text-[#A2A790] pl-2">
                <span>• 1% Quema Permanente (Sink):</span>
                <span>-{Math.floor(publishQuantity * publishPricePerUnit * 0.01)}G</span>
              </div>
              <div className="flex justify-between text-[10px] text-[#A2A790] pl-2">
                <span>• 1% Regalía Provincia Soberana:</span>
                <span>-{Math.round(publishQuantity * publishPricePerUnit * 0.02) - Math.floor(publishQuantity * publishPricePerUnit * 0.01)}G</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-[#7B8A4A] font-black text-amber-300">
                <span>Ingreso Neto para tu Tesoro (98%):</span>
                <span>
                  {publishQuantity * publishPricePerUnit - Math.round(publishQuantity * publishPricePerUnit * 0.02)}G
                </span>
              </div>
            </div>

            {/* Botones del Modal */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#7B8A4A]">
              <button
                onClick={() => setIsPublishModalOpen(false)}
                className="px-3 py-1.5 rounded text-xs font-bold text-[#F2E8D5]/70 hover:text-white cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handlePublishListing}
                className="px-4 py-2 bg-[#C46A3A] hover:bg-[#b05c2e] text-[#F2E8D5] font-black text-xs uppercase tracking-wider rounded-[10px_3px_10px_3px] border border-[#2B2C24] shadow-[3px_3px_0px_#2B2C24] cursor-pointer"
              >
                Confirmar y Publicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
