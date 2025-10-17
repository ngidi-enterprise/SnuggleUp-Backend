import React, { useState, useEffect } from 'react';
import './App.css';
import CheckoutSuccess from './CheckoutSuccess';
import CheckoutCancel from './CheckoutCancel';

function App() {
  const [cartCount, setCartCount] = useState(0);
  const [cartItems, setCartItems] = useState([]);
  const [showCart, setShowCart] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState('home');
  const [voucherCode, setVoucherCode] = useState('');
  const [appliedVoucher, setAppliedVoucher] = useState(null);
  const [voucherError, setVoucherError] = useState('');

  // Check URL for routing
  useEffect(() => {
    const path = window.location.pathname;
    if (path.includes('/checkout/success')) {
      setCurrentPage('success');
    } else if (path.includes('/checkout/cancel')) {
      setCurrentPage('cancel');
    } else {
      setCurrentPage('home');
    }
  }, []);

  // Render different pages based on route
  if (currentPage === 'success') {
    return <CheckoutSuccess />;
  }

  if (currentPage === 'cancel') {
    return <CheckoutCancel />;
  }

  // Product data with real images
  const products = {
    newParents: [
      {
        id: 1,
        name: "Bottle Warmer & Sterilizer",
        description: "Fast warming & sterilising for peace of mind.",
        price: 399,
        image: "https://images.unsplash.com/photo-1584464491033-06628f3a6b7b?w=300&h=200&fit=crop",
        category: "feeding"
      },
      {
        id: 2,
        name: "Double Breast Pump",
        description: "Gentle, efficient double pumping.",
        price: 299,
        image: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=300&h=200&fit=crop",
        category: "feeding"
      },
      {
        id: 3,
        name: "Baby Walker",
        description: "Safe walker for curious babies.",
        price: 799,
        image: "https://images.unsplash.com/photo-1573396999515-c5e61aed4026?w=300&h=200&fit=crop",
        category: "mobility"
      }
    ],
    newborns: [
      {
        id: 4,
        name: "Bottle Warmer & Sterilizer",
        description: "Fast warming and sterilising for peace of mind.",
        price: 399,
        image: "https://images.unsplash.com/photo-1584464491033-06628f3a6b7b?w=300&h=200&fit=crop",
        category: "feeding"
      }
    ],
    newArrivals: [
      {
        id: 5,
        name: "Baby Bath Set",
        description: "Complete bathing essentials for your little one.",
        price: 249,
        image: "https://images.unsplash.com/photo-1544378403-4e3b7d5c8944?w=300&h=200&fit=crop",
        category: "bathing"
      },
      {
        id: 6,
        name: "Cotton Swaddle Blanket",
        description: "Soft, breathable cotton for peaceful sleep.",
        price: 279,
        image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=300&h=200&fit=crop",
        category: "sleep"
      },
      {
        id: 7,
        name: "Teething Toy Set",
        description: "Safe, colorful toys to soothe teething pain.",
        price: 199,
        image: "https://images.unsplash.com/photo-1566308149096-a1ad1bbfe5a1?w=300&h=200&fit=crop",
        category: "toys"
      }
    ]
  };

  const addToCart = (product) => {
    const existingItem = cartItems.find(item => item.id === product.id);
    
    if (existingItem) {
      setCartItems(cartItems.map(item => 
        item.id === product.id 
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCartItems([...cartItems, { ...product, quantity: 1 }]);
    }
    
    setCartCount(cartCount + 1);
  };

  const removeFromCart = (productId) => {
    const item = cartItems.find(item => item.id === productId);
    if (item && item.quantity > 1) {
      setCartItems(cartItems.map(item => 
        item.id === productId 
          ? { ...item, quantity: item.quantity - 1 }
          : item
      ));
      setCartCount(cartCount - 1);
    } else {
      setCartItems(cartItems.filter(item => item.id !== productId));
      setCartCount(cartCount - (item ? item.quantity : 0));
    }
  };

  const getSubtotal = () => {
    return cartItems.reduce((total, item) => total + (item.price * item.quantity), 0);
  };

  const getShippingCost = () => {
    if (cartItems.length === 0) return 0;
    const subtotal = getSubtotal();
    return subtotal >= 800 ? 0 : 99;
  };

  const getDiscount = () => {
    return appliedVoucher ? appliedVoucher.value : 0;
  };

  const getTotalPrice = () => {
    const total = getSubtotal() + getShippingCost() - getDiscount();
    return total > 0 ? total : 0;
  };

  const applyVoucher = () => {
    // Define available vouchers (in production, this would come from backend)
    const vouchers = {
      'SAVE10': { code: 'SAVE10', value: 10, description: 'R10 off' },
      'SAVE50': { code: 'SAVE50', value: 50, description: 'R50 off' },
      'SAVE100': { code: 'SAVE100', value: 100, description: 'R100 off' },
      'WELCOME20': { code: 'WELCOME20', value: 20, description: 'R20 off for new customers' }
    };

    const voucher = vouchers[voucherCode.toUpperCase()];
    
    if (voucher) {
      setAppliedVoucher(voucher);
      setVoucherError('');
      setVoucherCode('');
    } else {
      setVoucherError('Invalid voucher code');
      setAppliedVoucher(null);
    }
  };

  const removeVoucher = () => {
    setAppliedVoucher(null);
    setVoucherCode('');
    setVoucherError('');
  };

  const toggleCart = () => {
    setShowCart(!showCart);
  };

  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
  };

  const filteredProducts = (productArray) => {
    if (!searchTerm) return productArray;
    return productArray.filter(product => 
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.category.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  const handleCheckout = async () => {
    try {
      // Save cart to localStorage for recovery if payment fails
      localStorage.setItem('cart', JSON.stringify(cartItems));

      const response = await fetch('https://snuggleup-backend.onrender.com/api/payments/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: getTotalPrice(),
          email: 'customer@snuggleup.co.za',
          orderItems: cartItems
        })
      });

      const html = await response.text();
      // Write the PayFast form to the current window and auto-submit
      document.open();
      document.write(html);
      document.close();
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Connection error. Please check if the backend server is running.');
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo-section">
          <div className="logo">👶</div>
          <div className="brand-info">
            <h1>SnuggleUp</h1>
            <p>Baby essentials for modern parents</p>
          </div>
        </div>
        <div className="header-right">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Search nappies, bottles, pumps..." 
              value={searchTerm}
              onChange={handleSearch}
            />
            <span className="search-icon">🔍</span>
          </div>
          <button className="checkout-btn" onClick={toggleCart}>
            Checkout
            <div className="cart-count">{cartCount}</div>
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero">
        <h2>Everything your little one needs — delivered fast</h2>
        <p>Curated essentials selected for comfort, safety and convenience. Special offers for first-time parents. Free local delivery over R800.</p>
        <button className="cta-button">Shop baby essentials</button>
      </section>

      {/* Top Picks for New Parents */}
      <section className="product-section">
        <div className="section-header">
          <h3>Top Picks for New Parents</h3>
          <span className="section-subtitle">Trusted and loved</span>
        </div>
        <div className="product-grid">
          {filteredProducts(products.newParents).map(product => (
            <div key={product.id} className="product-card">
              <img 
                src={product.image} 
                alt={product.name}
                className="product-image"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              <div className="product-image" style={{display: 'none'}}>🍼</div>
              <h4>{product.name}</h4>
              <p>{product.description}</p>
              <div className="product-price">R{product.price}</div>
              <button 
                className="add-to-cart" 
                onClick={() => addToCart(product)}
              >
                Add to Cart
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Top Picks for Newborns */}
      <section className="product-section">
        <div className="section-header">
          <h3>Top Picks for Newborns</h3>
          <span className="section-subtitle">Perfect first essentials</span>
        </div>
        <div className="product-grid">
          {filteredProducts(products.newborns).map(product => (
            <div key={product.id} className="product-card">
              <img 
                src={product.image} 
                alt={product.name}
                className="product-image"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              <div className="product-image" style={{display: 'none'}}>🍼</div>
              <h4>{product.name}</h4>
              <p>{product.description}</p>
              <button 
                className="add-to-cart" 
                onClick={() => addToCart(product)}
              >
                Buy now - R{product.price}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* New Arrivals */}
      <section className="product-section new-arrivals">
        <h3>New Arrivals — Just In for Your Little One!</h3>
        <div className="product-grid">
          {filteredProducts(products.newArrivals).map(product => (
            <div key={product.id} className="product-card">
              <img 
                src={product.image} 
                alt={product.name}
                className="product-image"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              <div className="product-image" style={{display: 'none'}}>
                {product.category === 'bathing' ? '🛁' : 
                 product.category === 'sleep' ? '🧸' : '🦷'}
              </div>
              <h4>{product.name}</h4>
              <p>From R{product.price}</p>
              <button 
                className="add-to-cart" 
                onClick={() => addToCart(product)}
              >
                Add to Cart
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Shopping Cart Modal */}
      {showCart && (
        <div className="cart-overlay" onClick={toggleCart}>
          <div className="cart-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cart-header">
              <h3>Shopping Cart ({cartCount} items)</h3>
              <button className="close-cart" onClick={toggleCart}>✕</button>
            </div>
            <div className="cart-items">
              {cartItems.length === 0 ? (
                <p className="empty-cart">Your cart is empty</p>
              ) : (
                cartItems.map(item => (
                  <div key={item.id} className="cart-item">
                    <img src={item.image} alt={item.name} className="cart-item-image" />
                    <div className="cart-item-details">
                      <h4>{item.name}</h4>
                      <p>R{item.price} each</p>
                      <div className="quantity-controls">
                        <button onClick={() => removeFromCart(item.id)}>-</button>
                        <span>{item.quantity}</span>
                        <button onClick={() => addToCart(item)}>+</button>
                      </div>
                    </div>
                    <div className="cart-item-total">
                      R{item.price * item.quantity}
                    </div>
                  </div>
                ))
              )}
            </div>
            {cartItems.length > 0 && (
              <div className="cart-footer">
                <div className="cart-total">
                  <p style={{marginBottom: '8px'}}>Subtotal: R{getSubtotal()}</p>
                  <p style={{marginBottom: '8px'}}>Shipping: R{getShippingCost()}</p>
                  {appliedVoucher && (
                    <p style={{marginBottom: '8px', color: '#28a745'}}>
                      Discount ({appliedVoucher.code}): -R{appliedVoucher.value}
                      <button 
                        onClick={removeVoucher}
                        style={{marginLeft: '8px', background: 'transparent', border: 'none', color: '#dc3545', cursor: 'pointer', fontSize: '0.9em'}}
                      >
                        ✕
                      </button>
                    </p>
                  )}
                  {getSubtotal() >= 700 && getSubtotal() < 800 && (
                    <p style={{color: '#ff6600', fontWeight: 'bold', marginBottom: '8px', fontSize: '0.9em'}}>
                      🎉 Add R{(800 - getSubtotal()).toFixed(2)} more and get FREE shipping!
                    </p>
                  )}
                  <strong>Total: R{getTotalPrice()}</strong>
                </div>
                
                {!appliedVoucher && (
                  <div style={{marginTop: '12px', marginBottom: '12px'}}>
                    <input
                      type="text"
                      placeholder="Enter voucher code"
                      value={voucherCode}
                      onChange={(e) => setVoucherCode(e.target.value)}
                      style={{padding: '8px', width: '60%', border: '1px solid #ccc', borderRadius: '4px'}}
                    />
                    <button
                      onClick={applyVoucher}
                      style={{padding: '8px 16px', marginLeft: '8px', background: '#ff6600', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                    >
                      Apply
                    </button>
                    {voucherError && (
                      <p style={{color: '#dc3545', fontSize: '0.85em', marginTop: '4px'}}>{voucherError}</p>
                    )}
                  </div>
                )}
                
                <button className="proceed-checkout" onClick={handleCheckout}>
                  Proceed to PayFast Checkout
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <p>© 2025 SnuggleUp</p>
        <p>Made with <span className="heart">❤️</span> for all parents. Free local delivery over R800.</p>
        <p>Contact: support@snuggleup.co.za | +27 (0)10 123 4567</p>
      </footer>
    </div>
  );
}

export default App;
