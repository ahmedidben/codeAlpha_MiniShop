// async function loadProducts() {
//     try{
//         const res =await fetch('/products');
//         const data = await res.json();
//         console.log(data);

//         const container = document.getElementById('id');
//         container.innerHTML = ''; // Clear existing content
//         data.forEach(p => {
//             const div = document.createElement('div');
//             div.className = 'product';
//             div.innerHTML=`
//                 <h3>${p.name}</h3>
//                 <p> Price : ${p.price}</p>
//             `;
//             container.appendChild(div);
//         });
//     }catch(err){
//         console.error('Error loading products : ', err);
//     }
    
// };
// loadProducts();

function switchLogin(){
    const register = document.querySelector('.Register');
    const login = document.querySelector('.Login');
    register.classList.toggle('active');
    login.classList.toggle('active');
    register.classList.toggle('non-active');
    login.classList.toggle('non-active');
}