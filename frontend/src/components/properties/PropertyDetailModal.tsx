import { X, Bath, BedDouble, Maximize, Star, Calendar, DollarSign, MapPin, Home, Clock, Award } from "lucide-react";
import type { Property } from "../../types";
import { formatDate, formatPrice, formatTimestamp } from "../../lib/utils";

interface PropertyDetailModalProps {
  property: Property;
  onClose: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-500 text-white",
  pending: "bg-yellow-500 text-white",
  auction: "bg-red-500 text-white",
};

export default function PropertyDetailModal({ property: p, onClose }: PropertyDetailModalProps) {
  const status = (p.listing_status || "active").toLowerCase();
  const statusClass = STATUS_STYLES[status] || STATUS_STYLES.active;
  const score = parseFloat(p.recommendation_score || "0");
  const scorePercent = Math.min(score * 10, 100);
  const imageUrl = p.image_url || `https://picsum.photos/seed/${p.property_id}/800/500`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full bg-white/90 p-1.5 shadow-md transition hover:bg-white"
        >
          <X className="h-5 w-5 text-gray-600" />
        </button>

        {/* Image */}
        <div className="relative h-64 overflow-hidden rounded-t-2xl bg-gray-100">
          <img src={imageUrl} alt={p.address} className="h-full w-full object-cover" />
          <span className={`absolute left-4 top-4 rounded-full px-3 py-1 text-sm font-bold uppercase shadow ${statusClass}`}>
            {status}
          </span>
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-6 pb-4 pt-10">
            <span className="text-3xl font-bold text-white">{formatPrice(p.price)}</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Address */}
          <h2 className="text-xl font-bold text-gray-900">{p.address}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
            <MapPin className="h-4 w-4" />
            {p.neighborhood} &middot; {p.city}, {p.state} {p.zip_code}
          </p>

          {/* Key stats */}
          <div className="mt-4 grid grid-cols-3 gap-4 rounded-lg bg-gray-50 p-4">
            <div className="flex items-center gap-2">
              <BedDouble className="h-5 w-5 text-xome-600" />
              <div>
                <div className="text-lg font-semibold">{p.beds}</div>
                <div className="text-xs text-gray-500">Beds</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Bath className="h-5 w-5 text-xome-600" />
              <div>
                <div className="text-lg font-semibold">{p.baths}</div>
                <div className="text-xs text-gray-500">Baths</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Maximize className="h-5 w-5 text-xome-600" />
              <div>
                <div className="text-lg font-semibold">{parseInt(p.sqft || "0").toLocaleString()}</div>
                <div className="text-xs text-gray-500">Sqft</div>
              </div>
            </div>
          </div>

          {/* Details grid */}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-gray-600">
              <Home className="h-4 w-4 text-gray-400" />
              <span className="font-medium">Type:</span> {p.property_type}
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span className="font-medium">Built:</span> {p.year_built}
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <Clock className="h-4 w-4 text-gray-400" />
              <span className="font-medium">Days on Market:</span> {p.days_on_market}
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <DollarSign className="h-4 w-4 text-gray-400" />
              <span className="font-medium">HOA:</span> {p.hoa_fee ? `$${p.hoa_fee}/mo` : "None"}
            </div>
            {p.school_rating && (
              <div className="flex items-center gap-2 text-gray-600">
                <Star className="h-4 w-4 text-yellow-400 fill-yellow-400" />
                <span className="font-medium">School Rating:</span> {p.school_rating}/10
              </div>
            )}
          </div>

          {/* Auction banner */}
          {status === "auction" && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700">
                Auction Date: {formatDate(p.auction_date)}
              </p>
              <p className="text-sm text-red-600">
                Starting Price: {formatPrice(p.auction_start_price || "0")}
              </p>
            </div>
          )}

          {/* Recommendation score */}
          {p.recommendation_score && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 font-medium text-gray-700">
                  <Award className="h-4 w-4 text-xome-600" /> Match Score
                </span>
                <span className="font-bold text-xome-700">{score.toFixed(1)} / 10</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-xome-500 transition-all" style={{ width: `${scorePercent}%` }} />
              </div>
            </div>
          )}

          {/* Recommendation reason */}
          {p.recommendation_reason && (
            <div className="mt-4 rounded-lg bg-xome-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-xome-600">Why Recommended</p>
              <p className="mt-1 text-sm text-gray-700">{p.recommendation_reason}</p>
            </div>
          )}

          {/* Campaign sent banner */}
          {p.campaign_sent_date && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm font-semibold text-blue-700">
                Campaign sent on {formatDate(p.campaign_sent_date)}
              </p>
            </div>
          )}

          {/* Email saved banner */}
          {p.campaign_saved_date && !p.campaign_sent_date && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-700">
                Email saved on {formatTimestamp(p.campaign_saved_date)}
              </p>
            </div>
          )}

          {/* Description */}
          {p.description && (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Description</p>
              <p className="mt-1 text-sm leading-relaxed text-gray-700">{p.description}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
